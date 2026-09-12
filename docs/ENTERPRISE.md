# PyForge AI 企业部署指南

本指南面向 IT 管理员与 DevOps 工程师，介绍如何通过组策略（Group Policy）、移动设备管理（MDM）和静默安装在企业环境中大规模部署 PyForge AI。

> **适用范围**：当前模板为**推荐配置模板**。PyForge AI 后续版本将按需读取这些注册表 / 偏好设置；在实现前，模板可作为企业自定义安装包或配置管理脚本的基础。

---

## 目录

1. [部署方式概览](#部署方式概览)
2. [Windows 托管部署](#windows-托管部署)
3. [macOS 托管部署](#macos-托管部署)
4. [Linux 托管部署](#linux-托管部署)
5. [静默安装命令示例](#静默安装命令示例)
6. [配置项参考](#配置项参考)
7. [自动化脚本示例](#自动化脚本示例)

---

## 部署方式概览

| 平台 | 推荐部署方式 | 配置下发方式 |
| --- | --- | --- |
| Windows | MSI / NSIS `.exe` | Group Policy（GPO）、Intune、SCCM、脚本 |
| macOS | `.dmg` / `.app` + `.pkg`（可选） | MDM（Jamf、Intune、Kandji）、配置描述文件 |
| Linux | `.deb` / `.AppImage` | Ansible / SaltStack / Chef、自定义仓库 |

企业场景建议：

- 关闭或锁定自动更新通道，由内部软件仓库统一分发。
- 通过配置模板预设默认 PyPI 镜像、允许的 AI 服务端点等企业策略。
- 所有安装包应经过代码签名，避免终端安全软件拦截。

---

## Windows 托管部署

### 通过 Group Policy 部署 MSI

1. 将签名后的 MSI 上传至网络共享（如 `\\fileserver\software\PyForge_AI\`）。
2. 打开「组策略管理」，新建或编辑 GPO。
3. 导航到 **计算机配置 → 策略 → 软件设置 → 软件安装**。
4. 右键 → 新建 → 程序包，选择 UNC 路径的 MSI，选择部署方法（已发布/已分配）。
5. 客户端执行 `gpupdate /force` 后自动安装。

### 注册表设置模板

以下 `.reg` 文件用于向所有用户或当前用户下发托管配置。请替换 `<...>` 占位符后通过 GPO「注册表」首选项或 Intune 配置文件推送。

#### 计算机级策略（推荐，影响所有用户）

```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\PyForge AI\PyForge AI]
"OrganizationName"="<YOUR_ORG_NAME>"
"DefaultMirror"="https://pypi.org/simple"
"AllowedMirrors"="https://pypi.org/simple;https://mirrors.aliyun.com/pypi/simple"
"UpdateChannel"="enterprise"
"DisableAutoUpdate"=dword:00000001
"AllowedAiProviders"="openai;azure"
"AiBaseUrl"="https://api.openai.com/v1"
"LogLevel"="info"
"DataCollectionEnabled"=dword:00000000
```

#### 用户级策略

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\SOFTWARE\Policies\PyForge AI\PyForge AI]
"OrganizationName"="<YOUR_ORG_NAME>"
"DefaultMirror"="https://pypi.org/simple"
"AllowedMirrors"="https://pypi.org/simple;https://mirrors.aliyun.com/pypi/simple"
"UpdateChannel"="enterprise"
"DisableAutoUpdate"=dword:00000001
```

### 通过 Intune 部署

1. 在 Microsoft Intune 中，选择 **应用 → Windows → 添加 → 业务线应用**。
2. 上传 MSI 或转换后的 `.intunewin` 包。
3. 在「应用信息」中配置安装/卸载命令（见下方静默安装示例）。
4. 将应用分配到用户或设备组。

---

## macOS 托管部署

### 配置描述文件模板

将以下内容保存为 `com.pyforge-ai.config.mobileconfig`，通过 MDM 下发到受管设备。该描述文件向 `com.pyforge-ai.app` 写入托管偏好设置。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.pyforge-ai.app</string>
      <key>PayloadIdentifier</key>
      <string>com.pyforge-ai.app.config</string>
      <key>PayloadUUID</key>
      <string>AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadDisplayName</key>
      <string>PyForge AI Managed Preferences</string>
      <key>OrganizationName</key>
      <string>&lt;YOUR_ORG_NAME&gt;</string>
      <key>DefaultMirror</key>
      <string>https://pypi.org/simple</string>
      <key>AllowedMirrors</key>
      <array>
        <string>https://pypi.org/simple</string>
        <string>https://mirrors.aliyun.com/pypi/simple</string>
      </array>
      <key>UpdateChannel</key>
      <string>enterprise</string>
      <key>DisableAutoUpdate</key>
      <true/>
      <key>AllowedAiProviders</key>
      <array>
        <string>openai</string>
        <string>azure</string>
      </array>
      <key>AiBaseUrl</key>
      <string>https://api.openai.com/v1</string>
      <key>LogLevel</key>
      <string>info</string>
      <key>DataCollectionEnabled</key>
      <false/>
    </dict>
  </array>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadIdentifier</key>
  <string>com.pyforge-ai.enterprise.config</string>
  <key>PayloadUUID</key>
  <string>BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadDisplayName</key>
  <string>PyForge AI Enterprise Settings</string>
</dict>
</plist>
```

> 部署前请替换 `PayloadUUID` 为真实 UUID（可用 `uuidgen` 生成），并修改 `&lt;YOUR_ORG_NAME&gt;` 为企业名称。

### 通过 Jamf / Intune 分发 .dmg

1. 将签名并公证后的 `.dmg` 上传到 MDM 分发服务器。
2. 创建策略，执行挂载 `.dmg` 并拷贝 `.app` 到 `/Applications` 的脚本（见下方静默安装示例）。
3. 配置作用域为指定设备或用户组。

---

## Linux 托管部署

### Debian / Ubuntu（.deb）

将签名后的 `.deb` 放入内部 APT 仓库：

```bash
# 示例：使用 reprepro 维护仓库
reprepro includedeb stable /path/to/pyforge-ai_<version>_amd64.deb
```

客户端通过 Ansible 等工具安装：

```bash
sudo apt-get update
sudo apt-get install -y pyforge-ai
```

### 通用发行版（AppImage）

将 `.AppImage` 分发到 `/opt/pyforge-ai/` 并创建桌面入口：

```bash
sudo install -Dm755 /path/to/PyForge_AI_<version>.AppImage /opt/pyforge-ai/PyForge_AI.AppImage
sudo ln -sf /opt/pyforge-ai/PyForge_AI.AppImage /usr/local/bin/pyforge-ai
```

---

## 静默安装命令示例

### Windows MSI

```powershell
# 静默安装，不重启
msiexec /i "PyForge_AI_<version>_x64_en-US.msi" /qn /norestart

# 带日志记录
msiexec /i "PyForge_AI_<version>_x64_en-US.msi" /qn /norestart /l*v "C:\logs\pyforge-ai-install.log"

# 卸载
msiexec /x "PyForge_AI_<version>_x64_en-US.msi" /qn /norestart
```

### Windows NSIS `.exe`

```powershell
# 静默模式（/S 为大写）
.\PyForge_AI_<version>_x64-setup.exe /S

# 指定安装目录
.\PyForge_AI_<version>_x64-setup.exe /S /D=C:\Program Files\PyForge AI
```

### macOS DMG

```bash
#!/bin/bash
set -e

DMG="PyForge_AI_<version>_x64.dmg"
MOUNT_POINT="/Volumes/PyForge AI"

hdiutil attach "$DMG" -nobrowse -quiet
cp -R "$MOUNT_POINT/PyForge AI.app" /Applications/
hdiutil detach "$MOUNT_POINT" -quiet
```

### macOS PKG（如生成）

```bash
# 静默安装到 /Applications
sudo installer -pkg PyForge_AI_<version>.pkg -target /
```

### Linux AppImage

```bash
#!/bin/bash
set -e

APP_IMAGE="PyForge_AI_<version>.AppImage"
INSTALL_DIR="/opt/pyforge-ai"

sudo mkdir -p "$INSTALL_DIR"
sudo install -Dm755 "$APP_IMAGE" "$INSTALL_DIR/PyForge_AI.AppImage"
sudo ln -sf "$INSTALL_DIR/PyForge_AI.AppImage" /usr/local/bin/pyforge-ai
```

### Linux deb

```bash
# 本地静默安装
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ./pyforge-ai_<version>_amd64.deb

# 卸载
sudo apt-get remove -y pyforge-ai
```

### Linux rpm

```bash
# 静默安装
sudo rpm -Uvh --quiet pyforge-ai-<version>.x86_64.rpm

# 卸载
sudo rpm -e pyforge-ai
```

---

## 配置项参考

| 配置项 | 类型 | 说明 |
| --- | --- | --- |
| `OrganizationName` | 字符串 | 企业名称，可显示在「关于」窗口。 |
| `DefaultMirror` | 字符串 | 默认 PyPI 镜像地址。 |
| `AllowedMirrors` | 字符串/数组 | 允许用户切换的镜像白名单。 |
| `UpdateChannel` | 字符串 | `stable`、`beta`、`enterprise`；`enterprise` 表示由内部仓库管理更新。 |
| `DisableAutoUpdate` | 布尔/DWORD | 是否禁用内置自动更新。 |
| `AllowedAiProviders` | 字符串/数组 | 允许的 AI 服务商白名单。 |
| `AiBaseUrl` | 字符串 | 默认 AI API 基础地址。 |
| `LogLevel` | 字符串 | `debug`、`info`、`warn`、`error`。 |
| `DataCollectionEnabled` | 布尔/DWORD | 是否允许匿名诊断数据收集。 |

---

## 自动化脚本示例

### Ansible（Linux deb）

```yaml
- name: Install PyForge AI
  apt:
    deb: "https://artifacts.example.com/pyforge-ai/pyforge-ai_{{ pyforge_version }}_amd64.deb"
    state: present

- name: Deploy managed config
  template:
    src: pyforge-ai.conf.j2
    dest: /etc/pyforge-ai/config.toml
    mode: '0644'
```

### PowerShell（Windows 静默安装 + 注册表配置）

```powershell
$installer = "\\fileserver\software\PyForge_AI\PyForge_AI_<version>_x64-setup.exe"
& $installer /S /D="C:\Program Files\PyForge AI"

New-Item -Path "HKLM:\SOFTWARE\Policies\PyForge AI\PyForge AI" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\PyForge AI\PyForge AI" -Name "DisableAutoUpdate" -Value 1
```

### Bash（macOS MDM 脚本）

```bash
#!/bin/bash
set -e

curl -fsSL "https://artifacts.example.com/pyforge-ai/PyForge_AI_<version>_x64.dmg" -o /tmp/pyforge-ai.dmg
hdiutil attach /tmp/pyforge-ai.dmg -nobrowse -quiet
cp -R "/Volumes/PyForge AI/PyForge AI.app" /Applications/
hdiutil detach "/Volumes/PyForge AI" -quiet
rm /tmp/pyforge-ai.dmg
```

---

## 安全与合规建议

- 所有分发安装包必须通过企业代码签名证书签名。
- 关闭公开更新通道时，请确保内部更新服务器可用并校验签名。
- 敏感配置（如 AI API Key）不应通过注册表或配置描述文件下发；建议使用 SSO / 密钥管理系统按需注入。
- 定期审计设备上的安装版本与配置合规性。
