# Claude Code 弹窗提醒功能 - 使用说明

## 快速开始

### 1. 安装脚本

将 `show-notification.ps1` 文件复制到用户配置目录：

```powershell
# 复制脚本到 Claude Code 配置目录
cp "hook-test/show-notification.ps1" "$env:USERPROFILE\.claude\show-notification.ps1"
```

### 2. 更新配置

编辑 `C:\Users\你的用户名\.claude\settings.json` 文件，添加 `hooks` 配置部分。

参考 `settings-example.json` 中的配置，将 `hooks` 部分添加到你的配置文件中。

**重要提示**：
- 路径中的双反斜杠 `\\` 必须保留
- 根据你的用户名调整路径（将 `15962` 替换为你的实际用户名）

### 3. 测试脚本

在 PowerShell 中运行以下命令测试脚本是否工作：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\show-notification.ps1" -Title "测试" -Message "如果看到此弹窗，说明配置成功！"
```

如果看到弹窗，说明脚本工作正常。

## 配置详解

### Hook 事件类型

#### Notification 事件

| Matcher | 说明 | 触发时机 |
|---------|------|---------|
| `permission` | 权限请求 | Claude 需要用户批准某个操作 |
| `idle` | 等待输入 | Claude 等待用户输入或指令 |

#### Stop 事件

| Matcher | 说明 | 触发时机 |
|---------|------|---------|
| 空（不指定） | 任务完成 | Claude 完成响应 |

### 图标类型

PowerShell 脚本支持四种图标：

| 图标类型 | 说明 | 适用场景 |
|---------|------|---------|
| `Information` | 信息提示 | 一般通知、任务完成 |
| `Warning` | 警告 | 需要注意但不严重的问题 |
| `Error` | 错误 | 任务失败或严重问题 |
| `Question` | 询问 | 权限请求、用户确认 |

## 常见问题

### Q1: 弹窗没有出现

**可能原因：**
1. PowerShell 脚本路径不正确
2. PowerShell 执行策略限制
3. JSON 配置格式错误

**解决方法：**
1. 检查脚本路径是否存在
2. 在命令中添加 `-ExecutionPolicy Bypass`
3. 使用 JSON 验证工具检查配置文件格式

### Q2: 弹窗卡住 Claude Code

**原因：** MessageBox 是模态对话框，会阻塞执行。

**解决方法：** 当前实现需要用户手动关闭弹窗。这是预期行为，确保用户注意到通知。

### Q3: 频繁弹窗影响工作

**解决方法：** 根据实际使用情况，可以：
1. 只启用必要的 hook（如只保留 `Stop` 事件）
2. 调整触发条件（使用更具体的 matcher）
3. 考虑使用声音提醒替代部分弹窗

### Q4: 路径中的反斜杠问题

**问题：** JSON 中单个反斜杠会被解析为转义字符。

**解决：** 在 JSON 配置中，Windows 路径必须使用双反斜杠 `\\`：

```json
# 错误
"command": "powershell -File \"C:\Users\15962\.claude\show-notification.ps1\""

# 正确
"command": "powershell -File \"C:\\Users\\15962\\.claude\\show-notification.ps1\""
```

## 自定义配置

### 添加声音提醒

在弹窗前播放系统提示音：

```json
{
  "type": "command",
  "command": "powershell -c \"[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 100; & 'C:\\Users\\15962\\.claude\\show-notification.ps1' -Title '任务完成' -Message 'Claude Code 已完成任务' -Icon 'Information'\""
}
```

### 区分任务状态

成功和失败使用不同图标：

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

### 使用 BurntToast（现代 Toast 通知）

如果希望更现代的通知样式，可以改用 BurntToast：

**1. 安装 BurntToast 模块：**
```powershell
Install-Module -Name BurntToast -Scope CurrentUser -Force
```

**2. 修改脚本或直接在配置中使用：**
```json
{
  "type": "command",
  "command": "powershell -c \"Import-Module BurntToast; New-BurntToastNotification -Text '任务完成', 'Claude Code 已完成任务'\""
}
```

## 卸载

如需禁用弹窗提醒，只需从 `settings.json` 中删除 `hooks` 部分即可：

```json
{
  "env": { ... },
  "permissions": { ... },
  "enabledPlugins": {}
  // 删除 "hooks" 部分
}
```

或保留配置但注释掉（在 JSON 中不支持注释，需要完全删除）。

## 性能优化建议

1. **减少不必要的 hook**：只启用你真正需要的提醒类型
2. **使用声音替代弹窗**：对于频繁触发的场景，声音比弹窗干扰更小
3. **考虑使用 Toast 通知**：BurntToast 的通知比 MessageBox 更轻量
4. **设置合理的触发条件**：使用更具体的 matcher 减少误触发

## 相关资源

- [Claude Code 官方文档](https://docs.anthropic.com/claude/code)
- [Claude Code Hooks 文档](https://docs.anthropic.com/claude/code/hooks)
- [Windows Forms MessageBox](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.messagebox)
- [PowerShell 执行策略](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-executionpolicy)
