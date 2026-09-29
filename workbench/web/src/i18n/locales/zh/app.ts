// -*- coding: utf-8 -*-
/** 工作台外壳：侧边栏、更新检查、Toast、标题 */
export default {
  brand: '场记 Slate',
  docTitle: 'AI 短片分析工作台',
  navAria: '工作台导航',
  currentProject: '当前项目',
  pickProject: '— 选择项目 —',
  language: '界面语言',
  logout: '退出登录',
  update: {
    behind: 'GitHub 有更新（落后 {n} 个提交）',
    ahead: '本地领先 {n} 个提交（未推送）',
    latest: '已是最新版本',
    pull: '拉取更新并重启',
    rollback: '回滚上一版本',
    rollbackTitle: '回滚到上次更新前的版本（更新时自动留了 backup 分支）',
    upToDate: '已是最新',
    needsBuild: '更新完成，但含前端源码改动：请先在仓库根执行 npm ci && npm run build，再重启生效',
    restarting: '更新完成，进程即将退出：keepalive 守护下会自动拉起新版本，否则请手动重启',
    failed: '更新失败',
    rollbackConfirm: '回滚到上次更新前的版本？（当前工作区需干净）',
    rolledBack: '已回滚到 {ref}，进程即将退出：keepalive 守护下会自动拉起，否则请手动重启',
    rollbackFailed: '回滚失败'
  }
}
