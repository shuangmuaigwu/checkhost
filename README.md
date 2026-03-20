# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## GitHub Actions Build

项目已包含 GitHub Actions 工作流：`.github/workflows/build-desktop.yml`。

触发方式：

- 推送到 `main` 或 `master`
- 推送 `v*` 标签
- 在 GitHub Actions 页面手动执行 `Build Desktop Bundles`

产物说明：

- `CheckHosts-windows-x64`：Windows x64 的 NSIS 安装包 `.exe`
- `CheckHosts-ubuntu-x64`：Ubuntu x64 的 `.deb` 和 `.AppImage`

下载方式：

- 推送到 `main` / `master` 或手动触发后，在对应 Actions 运行页的 `Artifacts` 区域下载
- 推送 `v0.1.0` 这类标签后，GitHub 会自动创建 / 更新 Release，并把安装包挂到 Release Assets 里
