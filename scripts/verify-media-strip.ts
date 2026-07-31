/**
 * 验收：stripAttachmentRefs + 空正文回落
 * 运行：npx tsx scripts/verify-media-strip.ts
 */
import { stripAttachmentRefs, emptyTextWithAttachmentsFallback } from '../src/media/strip.js';
import {
  formatAttachmentsForPrompt,
  sanitizeMediaBatchId,
  mediaBatchDir,
  type ResolvedAttachment,
} from '../src/media/cache.js';
import { buildPlist } from '../src/daemon/launchd.js';
import { buildUnit } from '../src/daemon/systemd.js';
import { buildLauncherCmd } from '../src/daemon/schtasks.js';
import {
  LAUNCH_AGENT_LABEL,
  SYSTEMD_UNIT_NAME,
  WINDOWS_TASK_NAME,
  looksLikeNpxCachePath,
} from '../src/daemon/paths.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(stripAttachmentRefs('看图 ![image](img_key_abc) 谢谢') === '看图 谢谢', 'md image stripped');
assert(stripAttachmentRefs('<file key="fk" name="a.pdf"/> 说明') === '说明', 'xml file stripped');
assert(stripAttachmentRefs('![x](k1)<image key="k2"/>') === '', 'all refs → empty');
assert(emptyTextWithAttachmentsFallback() === '请看附件。', 'fallback');

const atts: ResolvedAttachment[] = [{
  absPath: '/tmp/media/abc.png',
  kind: 'image',
  size: 10,
  mime: 'image/png',
  originalName: 'shot.png',
}];
const block = formatAttachmentsForPrompt(atts);
assert(block.includes('/tmp/media/abc.png'), 'prompt lists path');
assert(block.includes('shot.png'), 'prompt lists name');

const plist = buildPlist({
  nodePath: '/usr/bin/node',
  bridgeEntryPath: '/opt/lark-copilot-bridge/dist/lark-copilot-bridge.js',
  envPath: '/usr/bin',
  channelHome: '/Users/x/.lark-copilot-bridge',
});
assert(plist.includes(LAUNCH_AGENT_LABEL), 'plist label');
assert(plist.includes('<string>run</string>'), 'plist run arg');
assert(plist.includes('KeepAlive'), 'plist keepalive');
assert(plist.includes('WorkingDirectory'), 'plist workingDirectory');

const unit = buildUnit({
  nodePath: '/usr/bin/node',
  bridgeEntryPath: '/opt/bridge.js',
  envPath: '/usr/bin',
  channelHome: '/home/x/.lark-copilot-bridge',
});
assert(unit.includes('Restart=always'), 'systemd restart');
assert(unit.includes('WorkingDirectory='), 'systemd workingDirectory');
assert(/ExecStart=.*" run/.test(unit) || unit.includes('" run'), 'systemd run');

const cmd = buildLauncherCmd({
  nodePath: 'C:\\node.exe',
  bridgeEntryPath: 'C:\\bridge.js',
  envPath: 'C:\\Windows',
  channelHome: 'C:\\Users\\x\\.lark-copilot-bridge',
});
assert(cmd.includes(' run '), 'windows run');
assert(cmd.includes('cd /d "C:\\Users\\x\\.lark-copilot-bridge"'), 'windows cd /d channelHome');
assert(WINDOWS_TASK_NAME.length > 0, 'windows task name');

assert(looksLikeNpxCachePath('/Users/x/.npm/_npx/abc/node_modules/.bin/x'), 'npx detect');
assert(!looksLikeNpxCachePath('/usr/local/lib/node_modules/lark-copilot-bridge/dist/x.js'), 'global ok');

assert(sanitizeMediaBatchId('om_abc-123:xyz') === 'om_abc_123_xyz', 'sanitize messageId');
assert(sanitizeMediaBatchId('a' + 'b'.repeat(80)).length === 64, 'sanitize max len');
assert(mediaBatchDir('om_1', '/tmp/media') === '/tmp/media/om_1', 'batch dir');

console.log('✓ verify-media-strip (+ daemon unit strings) passed');
