/**
 * 访问控制（个人自用友好）
 *
 * - 默认 allowedUsers 为空 → 谁都能聊（扫码即用，不折腾）
 * - 特权命令（invite/remove/cd/ws）：有 owner 时仅 owner/admin；
 *   无 owner 且设了用户白名单 → 白名单/admin；完全无限制时仍全开（老配置）
 */
import type { BridgeConfig } from './config.js';

export function isOwner(senderId: string, ownerOpenId?: string): boolean {
  return Boolean(ownerOpenId && senderId === ownerOpenId);
}

export function isAdmin(senderId: string, config: BridgeConfig): boolean {
  return config.admins.includes(senderId);
}

export function isPrivileged(senderId: string, config: BridgeConfig, ownerOpenId?: string): boolean {
  if (ownerOpenId) {
    return isOwner(senderId, ownerOpenId) || isAdmin(senderId, config);
  }
  // 无 creator：有用户白名单则收紧；否则保持个人机全开
  if (config.allowedUsers.length > 0) {
    return isAdmin(senderId, config) || config.allowedUsers.includes(senderId);
  }
  return true;
}

/** 普通聊天/停任务：白名单空=全开；非空则 owner/admin/白名单 */
export function canUseBot(senderId: string, config: BridgeConfig, ownerOpenId?: string): boolean {
  if (config.allowedUsers.length === 0) return true;
  return isOwner(senderId, ownerOpenId)
    || isAdmin(senderId, config)
    || config.allowedUsers.includes(senderId);
}
