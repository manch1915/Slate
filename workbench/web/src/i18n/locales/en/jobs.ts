// -*- coding: utf-8 -*-
import type zh from '../zh/jobs'
export default {
  toastOk: '{label} — done',
  toastErr: '{label} — failed: {err}',
  seeLog: 'see the job log',
  evicted: 'Job record was evicted from the list',
  needLogin: 'Sign-in required; restart the job after signing in',
  pollRetry: '…polling failed ×{n}, retrying',
  lost: 'Job record lost (the server may have restarted); check on the related page whether the output was produced',
  interrupted: ' (interrupted by a server restart, please run again)',
  fallbackLabel: 'Job #{id}',
  starting: 'Starting…'
} satisfies typeof zh
