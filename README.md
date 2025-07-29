# EnhancedWDL

专业的 WDL (Workflow Description Language) 语法高亮和语言支持扩展，为现代代码编辑器提供增强功能。

**中文 | [English](README_EN.md)**

## ✨ 主要特性

### 🎨 语法高亮
- 完整的 WDL 关键字、数据类型、操作符和语法结构高亮
- 支持字符串插值语法：`~{variable}` 和 `${expression}`
- `#` 风格注释高亮
- 命令块高亮，支持嵌入式 shell 脚本
- 智能括号匹配和自动闭合
- 自动关联 `.wdl` 文件

### 🧠 智能语言服务
- **任务输入提示**：调用任务时显示所需输入参数
- **输出自动完成**：引用任务输出时提供智能补全
- **悬停信息**：鼠标悬停显示详细的参数信息
- **实时验证**：语法错误实时检查和高亮
- **符号解析**：支持本地任务定义和导入任务
- **导入别名处理**：正确处理导入别名

## 🔧 支持的 WDL 元素

### 基础语法
- 版本声明 (`version 2.0`)
- 导入语句和别名 (`import "file.wdl" as alias`)
- 工作流和任务定义
- 结构体定义 (WDL 2.0)
- 输入/输出块
- 命令块 (`<<<` 和 `>>>` 分隔符)
- 运行时规范

### 数据类型
- 基础类型：`String`, `Int`, `Float`, `Boolean`, `File`
- 集合类型：`Array`, `Map`, `Pair`, `Object`
- 泛型嵌套：`Array[Map[String, File]]`
- 自定义结构体类型

### 控制流
- 条件语句：`if/else`
- 分散块：`scatter`
- 变量引用和字符串插值

### 内置函数
`select_first`, `select_all`, `defined`, `length`, `basename`, `size`, `glob`, `read_*`, `write_*`, `stdout`, `stderr`, `floor`, `ceil`, `round`, `min`, `max`, `sep`, `quote`, `squote`, `sub`, `range`, `transpose`, `zip`, `cross`, `unzip`, `flatten`

## 🚀 使用方法

### 任务输入提示
编写任务调用时，获得输入参数的自动完成建议：

```wdl
call ProcessSample {
    input:
        sample_name = "test",  // 自动完成会建议可用的输入参数
        input_file = some_file,
        // 在此处输入可看到更多输入建议
}
```

### 任务输出引用
引用任务输出时，获得智能补全：

```wdl
call ProcessSample { ... }

call QualityCheck {
    input:
        input_file = ProcessSample.  // 自动完成显示可用输出
}
```

### 悬停信息
将鼠标悬停在以下元素上：
- 任务名称：查看输入/输出签名
- 参数名称：查看类型和描述
- 任务.输出引用：查看输出详情

## 📦 安装

### VS Code
1. 编译 TypeScript 代码：`npm run compile`
2. 在 VS Code 中安装扩展
3. 打开 `.wdl` 文件即可使用所有功能

### 兼容性
此扩展遵循语言服务器协议 (LSP) 标准，支持：
- VS Code
- 基于 VS Code 的编辑器 (Cursor, Code-OSS 等)
- 任何支持 LSP 的编辑器
- Kiro IDE 语言系统

## 🏗️ 技术架构

基于语言服务器协议 (LSP) 架构：

1. **词法分析器**：WDL 语法标记化
2. **解析器**：生成抽象语法树 (AST)
3. **符号提供器**：管理任务和工作流符号
4. **补全提供器**：提供自动完成建议
5. **悬停提供器**：提供悬停信息
6. **诊断提供器**：验证 WDL 语法
