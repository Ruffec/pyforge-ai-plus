use super::DeploymentRequest;

pub const SYSTEM_PROMPT: &str = r#"You are PyForge AI, an expert Python deployment assistant.
Your job is to analyze user requests and produce actionable, accurate deployment plans.
When asked for JSON, output only valid JSON without markdown fences or extra commentary."#;

pub const DEPLOYMENT_PLAN_INSTRUCTIONS: &str = r#"Analyze the following user request and produce a deployment plan as a single JSON object with this schema:

{
  "python_version": "recommended Python version string, e.g. 3.11",
  "dependencies": [
    {
      "name": "package name",
      "version_constraint": "e.g. >=1.0,<2.0 or leave empty",
      "reason": "why this package is needed"
    }
  ],
  "commands": [
    "shell commands to execute, e.g. python -m venv .venv"
  ],
  "steps": [
    {
      "title": "step title",
      "status": "pending",
      "output": "optional known output or notes"
    }
  ],
  "explanation": "concise explanation of the plan"
}

Use status values: pending, in_progress, completed."#;

pub fn deployment_plan_prompt(request: &DeploymentRequest) -> String {
    let project = request.project_path.as_deref().unwrap_or("(not provided)");
    format!(
        "{}\n\nUser request: {}\nProject path: {}\n\nReturn ONLY the JSON plan. Do not wrap it in markdown.",
        DEPLOYMENT_PLAN_INSTRUCTIONS, request.user_input, project
    )
}

pub fn dependency_analysis_prompt(requirements_content: &str) -> String {
    format!(
        r#"Analyze the following requirements.txt content for dependency conflicts, version incompatibilities, or missing constraints. Return a JSON array where each item has the schema:

{{
  "package_a": "first conflicting package",
  "package_b": "second conflicting package or empty string if not applicable",
  "reason": "description of the conflict",
  "suggestion": "recommended fix"
}}

If no conflicts are detected, return an empty array [].

requirements.txt:
```
{}
```

Return ONLY valid JSON."#,
        requirements_content
    )
}
