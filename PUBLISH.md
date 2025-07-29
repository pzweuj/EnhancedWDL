# WDL Syntax Pro - 发布指南

## 📦 插件信息

- **名称**: WDL Syntax Pro
- **版本**: 1.0.0
- **描述**: Professional syntax highlighting and language support for WDL (Workflow Description Language) files with enhanced features
- **目标平台**: VS Code, Kiro IDE, 其他支持 TextMate 语法的编辑器

## 🚀 发布准备

### 1. 更新发布信息
在 `package.json` 中更新以下字段：
```json
{
  "publisher": "your-publisher-name",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/wdl-syntax-pro"
  }
}
```

### 2. 创建发布包
```bash
# 安装 vsce (VS Code Extension Manager)
npm install -g vsce

# 打包扩展
vsce package

# 这将生成 wdl-syntax-pro-1.0.0.vsix 文件
```

### 3. 发布到 VS Code Marketplace
```bash
# 登录到 Visual Studio Marketplace
vsce login your-publisher-name

# 发布扩展
vsce publish
```

### 4. 发布到 GitHub
1. 创建 GitHub 仓库: `wdl-syntax-pro`
2. 上传所有文件
3. 创建 Release 并附加 .vsix 文件

## 📋 发布清单

- [ ] 验证所有语法规则正常工作
- [ ] 运行 `node validate-grammar.js` 确保无错误
- [ ] 测试所有示例文件的语法高亮
- [ ] 更新版本号
- [ ] 更新 README.md 中的安装说明
- [ ] 创建 CHANGELOG.md
- [ ] 准备发布说明和截图

## 🎯 营销要点

### 核心卖点
1. **专业级语法高亮** - 支持 WDL 2.0 所有特性
2. **增强功能** - 内置函数、复杂类型、struct 定义
3. **轻量级** - 无需语言服务器，启动快速
4. **完整测试** - 包含全面的测试用例和边缘情况
5. **现代化** - 支持最新的 WDL 语法特性

### 目标用户
- 生物信息学研究人员
- 基因组学数据分析师
- Cromwell/WDL 工作流开发者
- 使用 Terra、AnVIL 等平台的用户

## 📊 竞争优势

相比其他 WDL 扩展：
- ✅ 支持 WDL 2.0 struct 定义
- ✅ 完整的内置函数高亮 (30+ 函数)
- ✅ 复杂嵌套类型支持
- ✅ 优化的性能和启动速度
- ✅ 全面的测试覆盖

## 📝 许可证建议

建议使用 MIT 许可证，便于开源社区使用和贡献。

## 🔄 后续版本规划

### v1.1.0 计划功能
- 代码片段 (snippets) 支持
- 更多内置函数
- 改进的错误恢复

### v1.2.0 计划功能
- 基本的语法验证
- 文档悬停提示
- 代码折叠支持