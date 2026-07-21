/** 共享类型（避免 config / client 各写一份 AppCredentials） */

export interface AppCredentials {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  creatorOpenId?: string;
}

export interface SendOpts {
  replyTo?: string;
  replyInThread?: boolean;
}
