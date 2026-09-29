// -*- coding: utf-8 -*-
import type zh from '../zh/app'
export default {
  brand: 'Slate',
  docTitle: 'AI Short Film Workbench',
  navAria: 'Workbench navigation',
  currentProject: 'Current project',
  pickProject: '— Select project —',
  language: 'Interface language',
  logout: 'Sign out',
  update: {
    behind: 'Update available on GitHub ({n} commits behind)',
    ahead: 'Local is {n} commits ahead (not pushed)',
    latest: 'Up to date',
    pull: 'Pull update & restart',
    rollback: 'Roll back to previous version',
    rollbackTitle: 'Roll back to the version before the last update (a backup branch was created automatically)',
    upToDate: 'Already up to date',
    needsBuild: 'Update complete, but it includes frontend source changes: run npm ci && npm run build in the repo root, then restart',
    restarting: 'Update complete, the process will exit now: under keepalive it restarts automatically, otherwise restart it manually',
    failed: 'Update failed',
    rollbackConfirm: 'Roll back to the version before the last update? (The working tree must be clean)',
    rolledBack: 'Rolled back to {ref}, the process will exit now: under keepalive it restarts automatically, otherwise restart it manually',
    rollbackFailed: 'Rollback failed'
  }
} satisfies typeof zh
