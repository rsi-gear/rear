/** Stable host/client messages; unknown DSH errors retain their original diagnostics. */
export const traceChatErrors = {
  unavailable: 'DSH native sessions are unavailable.',
  model: 'Choose an available model in Chat first.',
  directory: 'Trace chat directory is not a regular directory',
  conflict: 'Trace chat request identity conflict',
  record: 'Trace chat session metadata is invalid.',
  changed: 'Trace changed while loading. Please retry.',
  checksum: 'Trace identity or checksum mismatch',
  size: 'Trace export exceeds 50 MB. Select fewer traces; no evidence was truncated.',
  missing: 'Chat is not available in the workspace list.',
  unsupported: 'This DSH version does not support embedded Chat.',
} as const
