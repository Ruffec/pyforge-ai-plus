use async_openai::config::OpenAIConfig;
use async_openai::types::{
    ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
    ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs, ResponseFormat,
};
use async_openai::Client;
use futures::stream::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod prompts;

pub type Result<T> = std::result::Result<T, AiError>;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("OpenAI API error: {0}")]
    OpenAI(#[from] async_openai::error::OpenAIError),
    #[error("JSON error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("security error: {0}")]
    Security(#[from] crate::security::SecurityError),
    #[error("invalid AI config: {0}")]
    Config(String),
    #[error("no completion choices returned")]
    NoChoices,
}

fn default_temperature() -> f32 {
    0.7
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub api_provider: String,
    pub api_key: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    pub use_local_llm: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentRequest {
    pub user_input: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentPlan {
    pub python_version: String,
    pub dependencies: Vec<DependencyRecommendation>,
    pub commands: Vec<String>,
    pub steps: Vec<DeploymentStep>,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyRecommendation {
    pub name: String,
    pub version_constraint: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentStep {
    pub title: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyConflict {
    pub package_a: String,
    pub package_b: String,
    pub reason: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct AiService {
    config: AiConfig,
    client: reqwest::Client,
}

impl AiService {
    pub fn new(config: AiConfig) -> Result<Self> {
        if config.model.is_empty() {
            return Err(AiError::Config("model is required".into()));
        }
        if !config.use_local_llm && config.api_key.is_empty() {
            return Err(AiError::Config(
                "api_key is required for non-local providers".into(),
            ));
        }
        if let Some(ref base_url) = config.base_url {
            crate::security::validate_url_scheme(base_url, &["http", "https"])?;
        }
        Ok(Self {
            config,
            client: reqwest::Client::new(),
        })
    }

    pub async fn generate_plan(&self, request: DeploymentRequest) -> Result<DeploymentPlan> {
        let openai_client = self.build_openai_client()?;
        let messages: Vec<ChatCompletionRequestMessage> = vec![
            system_message(prompts::SYSTEM_PROMPT)?,
            user_message(prompts::deployment_plan_prompt(&request).as_str())?,
        ];

        let response = openai_client
            .chat()
            .create(
                CreateChatCompletionRequestArgs::default()
                    .model(self.config.model.clone())
                    .messages(messages)
                    .response_format(ResponseFormat::JsonObject)
                    .temperature(self.config.temperature)
                    .build()?,
            )
            .await?;

        let content = response
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .ok_or(AiError::NoChoices)?;
        let plan: DeploymentPlan = serde_json::from_str(&content)?;
        Ok(plan)
    }

    pub async fn stream_chat(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<impl Stream<Item = Result<String>> + Send + 'static> {
        let openai_client = self.build_openai_client()?;
        let mut openai_messages = vec![system_message(prompts::SYSTEM_PROMPT)?];
        openai_messages.extend(self.to_openai_messages(messages)?);

        let request = CreateChatCompletionRequestArgs::default()
            .model(self.config.model.clone())
            .messages(openai_messages)
            .temperature(self.config.temperature)
            .stream(true)
            .build()?;

        let stream = openai_client.chat().create_stream(request).await?;
        Ok(stream.filter_map(|chunk| async move {
            match chunk {
                Ok(resp) => resp
                    .choices
                    .into_iter()
                    .next()
                    .and_then(|c| c.delta.content)
                    .map(Ok),
                Err(e) => Some(Err(AiError::OpenAI(e))),
            }
        }))
    }

    pub async fn analyze_dependencies(
        &self,
        requirements_content: &str,
    ) -> Result<Vec<DependencyConflict>> {
        let openai_client = self.build_openai_client()?;
        let messages: Vec<ChatCompletionRequestMessage> = vec![
            system_message(prompts::SYSTEM_PROMPT)?,
            user_message(prompts::dependency_analysis_prompt(requirements_content).as_str())?,
        ];

        let response = openai_client
            .chat()
            .create(
                CreateChatCompletionRequestArgs::default()
                    .model(self.config.model.clone())
                    .messages(messages)
                    .response_format(ResponseFormat::JsonObject)
                    .temperature(self.config.temperature)
                    .build()?,
            )
            .await?;

        let content = response
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .unwrap_or_default();
        if content.trim().is_empty() {
            return Ok(vec![]);
        }
        let conflicts: Vec<DependencyConflict> = serde_json::from_str(&content)?;
        Ok(conflicts)
    }

    pub async fn complete_chat(&self, messages: Vec<ChatMessage>) -> Result<String> {
        let openai_client = self.build_openai_client()?;
        let mut openai_messages = vec![system_message(prompts::SYSTEM_PROMPT)?];
        openai_messages.extend(self.to_openai_messages(messages)?);

        let response = openai_client
            .chat()
            .create(
                CreateChatCompletionRequestArgs::default()
                    .model(self.config.model.clone())
                    .messages(openai_messages)
                    .temperature(self.config.temperature)
                    .build()?,
            )
            .await?;

        let content = response
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .unwrap_or_default();
        Ok(content)
    }

    fn build_openai_client(&self) -> Result<Client<OpenAIConfig>> {
        let mut config = OpenAIConfig::new().with_api_key(self.config.api_key.clone());
        if let Some(ref base_url) = self.config.base_url {
            crate::security::validate_url_scheme(base_url, &["http", "https"])?;
            config = config.with_api_base(base_url.clone());
        }
        Ok(Client::with_config(config).with_http_client(self.client.clone()))
    }

    fn to_openai_messages(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<Vec<ChatCompletionRequestMessage>> {
        messages
            .into_iter()
            .map(|m| self.to_openai_message(m))
            .collect()
    }

    fn to_openai_message(&self, message: ChatMessage) -> Result<ChatCompletionRequestMessage> {
        match message.role.to_lowercase().as_str() {
            "system" => system_message(message.content.as_str()),
            "assistant" => Ok(ChatCompletionRequestAssistantMessageArgs::default()
                .content(message.content.as_str())
                .build()?
                .into()),
            _ => user_message(message.content.as_str()),
        }
    }
}

fn system_message(content: &str) -> Result<ChatCompletionRequestMessage> {
    Ok(ChatCompletionRequestSystemMessageArgs::default()
        .content(content)
        .build()?
        .into())
}

fn user_message(content: &str) -> Result<ChatCompletionRequestMessage> {
    Ok(ChatCompletionRequestUserMessageArgs::default()
        .content(content)
        .build()?
        .into())
}
