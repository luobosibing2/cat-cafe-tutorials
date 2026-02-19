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
