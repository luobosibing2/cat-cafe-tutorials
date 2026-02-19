# Claude Code 弹窗提醒功能 - 任务总结

## 项目背景

在 Windows 系统上使用 Claude Code CLI 时，当有工具调用需要确认、指令需要执行或任务完成时，用户希望能够在终端之外获得弹窗提醒，以便及时处理。

## 实现方案

### 技术选型

使用 **PowerShell + Windows Forms MessageBox** 实现：

- ✅ 无需安装额外依赖（BurntToast 需要手动安装模块）
- ✅ Windows 原生支持，即插即用
- ✅ 配置简单，易于维护
- ✅ 符合"在 CLI 中实现 hook"的需求

### Hook 事件映射

| 需求场景 | Hook 事件类型 | Matcher 条件 | 弹窗标题 | 弹窗内容 |
|---------|--------------|-------------|---------|---------|
| 等待确认的工具调用 | `Notification` | `permission` | 权限请求 | Claude Code 需要您的批准才能继续执行 |
| 需要执行的指令 | `Notification` | `idle` | 等待输入 | Claude Code 正在等待您的指令 |
| 任务完成状态 | `Stop` | 无 | 任务完成 | Claude Code 已完成任务 |

## 实施步骤

### 1. 创建 PowerShell 弹窗脚本

文件位置：`C:\Users\15962\.claude\show-notification.ps1`

```powershell
# 显示 Windows 弹窗通知
# 参数1: 标题
# 参数2: 消息内容
# 参数3: 图标类型 (可选: Information, Warning, Error, Question)

param(
    [Parameter(Mandatory=$true)]
    [string]$Title,

    [Parameter(Mandatory=$true)]
    [string]$Message,

    [ValidateSet("Information", "Warning", "Error", "Question")]
    [string]$Icon = "Information"
)

# 加载 Windows Forms 程序集
Add-Type -AssemblyName System.Windows.Forms

# 映射图标类型到 MessageBoxIcon
$iconMap = @{
    "Information" = [System.Windows.Forms.MessageBoxIcon]::Information
    "Warning" = [System.Windows.Forms.MessageBoxIcon]::Warning
    "Error" = [System.Windows.Forms.MessageBoxIcon]::Error
    "Question" = [System.Windows.Forms.MessageBoxIcon]::Question
}

# 显示弹窗
[System.Windows.Forms.MessageBox]::Show($Message, $Title, "OK", $iconMap[$Icon])
```

### 2. 配置 Claude Code Hooks

配置文件位置：`C:\Users\15962\.claude\settings.json`

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "your-url",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "permissions": {
    "allow": [
      "Bash",
      "Write",
      "Read",
      "Edit",
      "Glob",
      "Grep"
    ]
  },
  "enabledPlugins": {},
  "hooks": {
    "Notification": [
      {
        "matcher": "permission",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\15962\\.claude\\show-notification.ps1\" -Title \"权限请求\" -Message \"Claude Code 需要您的批准才能继续执行\" -Icon \"Question\""
          }
        ]
      },
      {
        "matcher": "idle",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\15962\\.claude\\show-notification.ps1\" -Title \"等待输入\" -Message \"Claude Code 正在等待您的指令\" -Icon \"Information\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\15962\\.claude\\show-notification.ps1\" -Title \"任务完成\" -Message \"Claude Code 已完成任务\" -Icon \"Information\""
          }
        ]
      }
    ]
  }
}
```

## 测试验证

### 测试 PowerShell 脚本

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\15962\.claude\show-notification.ps1" -Title "测试" -Message "这是一条测试消息"
```

### 测试各个场景

1. **权限请求提醒**
   - 在 Claude Code 中执行一个需要权限的操作
   - 验证是否弹出"权限请求"窗口

2. **等待输入提醒**
   - 让 Claude Code 等待你的输入
   - 验证是否弹出"等待输入"窗口

3. **任务完成提醒**
   - 执行一个完整任务
   - 验证任务完成后是否弹出"任务完成"窗口

## 文件清单

| 文件 | 说明 |
|-----|------|
| `C:\Users\15962\.claude\show-notification.ps1` | PowerShell 弹窗脚本 |
| `C:\Users\15962\.claude\settings.json` | Claude Code 配置文件（已添加 hooks） |
| `C:\Users\15962\.claude\settings.json.backup` | 原始配置备份 |
| `hook-test/show-notification.ps1` | 本项目中的脚本副本 |
| `hook-test/settings-example.json` | 配置示例 |
| `hook-test/README.md` | 本说明文档 |

## 进阶选项

### 选项 1：使用 BurntToast 模块

提供更现代的 Toast 通知样式：

```powershell
# 需要先安装模块（只需一次）
# Install-Module -Name BurntToast -Scope CurrentUser -Force

param([string]$Title, [string]$Message)

Import-Module BurntToast
New-BurntToastNotification -Text $Title, $Message
```

### 选项 2：添加声音提醒

在弹窗同时播放系统提示音：

```json
{
  "type": "command",
  "command": "powershell -c \"[System.Media.SystemSounds]::Asterisk.Play(); & 'C:\\Users\\15962\\.claude\\show-notification.ps1' -Title '任务完成' -Message 'Claude Code 已完成任务'\""
}
```

### 选项 3：区分成功/失败状态

根据任务结果显示不同的图标：

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "succeeded",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\15962\\.claude\\show-notification.ps1\" -Title \"任务成功\" -Message \"Claude Code 已成功完成任务\" -Icon \"Information\""
          }
        ]
      },
      {
        "matcher": "failed",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\15962\\.claude\\show-notification.ps1\" -Title \"任务失败\" -Message \"Claude Code 任务执行失败\" -Icon \"Error\""
          }
        ]
      }
    ]
  }
}
```

## 注意事项

1. **PowerShell 执行策略**：使用 `-ExecutionPolicy Bypass` 可以避免大多数执行策略问题
2. **路径转义**：在 JSON 中，Windows 路径需要使用双反斜杠 `\\`
3. **性能影响**：频繁的弹窗可能会影响工作流，建议根据实际使用情况调整
4. **阻塞问题**：MessageBox 会阻塞主线程，确保不会影响 Claude Code 的正常执行
5. **配置优先级**：项目级配置会覆盖全局配置，注意冲突问题

## 验证清单

- [x] PowerShell 脚本可以独立运行并显示弹窗
- [x] 配置文件 JSON 格式正确
- [ ] 权限请求时弹出提醒（需要实际使用时验证）
- [ ] 等待输入时弹出提醒（需要实际使用时验证）
- [ ] 任务完成时弹出提醒（需要实际使用时验证）
- [ ] 弹窗关闭后不影响 Claude Code 继续执行

## 参考资料

- [Claude Code Documentation](https://docs.anthropic.com/claude/code)
- [Claude Code Hooks](https://docs.anthropic.com/claude/code/hooks)
- [Windows Forms MessageBox](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.messagebox)

## 总结

通过在 Claude Code CLI 中配置 hooks，成功实现了在 Windows 系统上的弹窗提醒功能。该方案简单、可靠，无需额外依赖，能够有效提升用户在多任务处理时的体验。
