export function panelCss(): string {
  return `
    :host {
      color-scheme: dark;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      --mk-bg: #0c0c0c;
      --mk-surface: #141414;
      --mk-surface-2: #1b1b1c;
      --mk-surface-3: #202022;
      --mk-border: #2a2a2c;
      --mk-border-strong: #3f3f46;
      --mk-text: #fafafa;
      --mk-muted: #a1a1aa;
      --mk-quiet: #71717a;
      --mk-accent: #f59e0b;
      --mk-accent-strong: #fbbf24;
      --mk-success: #22c55e;
      --mk-danger: #ef4444;
      --mk-info: #3b82f6;
    }
    * {
      box-sizing: border-box;
    }
    .panel {
      width: min(398px, calc(100vw - 24px));
      margin: 12px 0;
      border: 1px solid var(--mk-border);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.028), rgba(255, 255, 255, 0.01)), var(--mk-surface);
      box-shadow: 0 22px 48px rgba(0, 0, 0, 0.34);
      overflow: hidden;
      font-size: 13px;
      line-height: 1.35;
      z-index: 2147483647;
      color: var(--mk-text);
    }
    .panel.collapsed {
      width: min(246px, calc(100vw - 24px));
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
    }
    .floating {
      position: fixed;
      top: 84px;
      right: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      border-bottom: 1px solid var(--mk-border);
      background:
        radial-gradient(circle at top left, rgba(245, 158, 11, 0.12), transparent 240px),
        #111111;
    }
    .collapsed .header {
      min-height: 42px;
      padding: 8px 10px 8px 12px;
      border-bottom: 0;
      cursor: pointer;
      background: #111111;
    }
    .headerTitle {
      min-width: 0;
    }
    .collapsedTitle strong {
      font-size: 13px;
      line-height: 1.1;
    }
    .eyebrow {
      display: block;
      margin: 0 0 5px;
      color: var(--mk-accent-strong);
      font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-transform: uppercase;
    }
    .header strong,
    .meta strong,
    .value strong {
      display: block;
      color: var(--mk-text);
      font-size: 13px;
      font-weight: 760;
    }
    .header span,
    .meta span,
    .value span {
      display: block;
      margin-top: 2px;
      color: var(--mk-muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .headerTitle > span:last-child {
      max-width: 210px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .header .eyebrow,
    .pointManagerTop .eyebrow,
    .detectedCandidatesTop .eyebrow {
      margin: 0 0 5px;
      color: var(--mk-accent-strong);
      font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-transform: uppercase;
    }
    .headerActions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .collapsed .headerActions {
      flex-wrap: nowrap;
    }
    .saveHeaderButton,
    .secondaryButton,
    .iconButton {
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--mk-accent);
      border-radius: 8px;
      background: var(--mk-accent);
      color: #111111;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
      transition:
        transform 100ms ease,
        border-color 150ms ease,
        background 150ms ease;
    }
    button:hover:not(:disabled) {
      border-color: var(--mk-accent-strong);
    }
    button:active:not(:disabled) {
      transform: translateY(1px);
    }
    .secondaryButton {
      border-color: var(--mk-border-strong);
      background: var(--mk-surface-2);
      color: var(--mk-text);
    }
    .iconButton {
      border: 1px solid var(--mk-border-strong);
      background: var(--mk-surface-2);
      color: var(--mk-muted);
      cursor: pointer;
    }
    .collapsed .collapseButton {
      min-height: 28px;
      padding: 0 9px;
    }
    .message {
      margin: 0;
      padding: 12px 14px;
      color: var(--mk-muted);
      overflow-wrap: anywhere;
    }
    .message.error {
      color: #fca5a5;
    }
    .capture {
      display: grid;
      gap: 7px;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: rgba(255, 255, 255, 0.02);
    }
    .capture > span {
      color: var(--mk-muted);
      font-size: 12px;
    }
    .capture .message {
      padding: 0;
      font-size: 12px;
    }
    .captureButton {
      min-height: 34px;
      border: 1px solid var(--mk-accent);
      border-radius: 8px;
      background: var(--mk-accent);
      color: #111111;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
    }
    .pointManager,
    .detectedCandidates {
      display: grid;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--mk-border);
      background: #101011;
    }
    .pointManagerTop,
    .pointChoice,
    .detectedCandidatesTop,
    .detectedCandidate {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .pointManagerTop,
    .detectedCandidatesTop {
      justify-content: space-between;
    }
    .detectedHeader {
      margin-top: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--mk-border);
    }
    .pointManagerTop strong,
    .detectedCandidatesTop strong,
    .pointChoiceText strong,
    .detectedCandidateText strong {
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .pointManagerTop span,
    .pointChoiceText span,
    .detectedCandidatesTop span,
    .detectedCandidateText span {
      display: block;
      color: var(--mk-muted);
      font-size: 11px;
    }
    .pointManagerControls {
      display: flex;
      gap: 6px;
    }
    .pointManagerControls button,
    .deleteButton,
    .saveSmallButton,
    .detailsButton {
      min-height: 28px;
      padding: 0 8px;
      border: 1px solid var(--mk-border-strong);
      border-radius: 8px;
      background: var(--mk-surface-2);
      color: var(--mk-text);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .pointChoice {
      min-height: 32px;
    }
    .pointChoice input,
    .compareToggle {
      width: 16px;
      height: 16px;
      margin: 0;
      flex: 0 0 auto;
      accent-color: var(--mk-accent);
    }
    .pointChoiceText,
    .detectedCandidateText,
    .metaText {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .meta {
      min-width: 0;
    }
    .metaHead {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
    }
    .rowActions {
      margin-top: 7px;
    }
    .rowActions .deleteButton {
      min-height: 24px;
      padding: 0 7px;
      font-size: 11px;
    }
    .deleteButton {
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }
    .saveSmallButton {
      border-color: rgba(245, 158, 11, 0.72);
      color: var(--mk-accent-strong);
    }
    .detailsButton {
      border-color: var(--mk-border-strong);
      color: var(--mk-muted);
    }
    .saveSmallButton:disabled {
      border-color: var(--mk-border);
      color: var(--mk-quiet);
      cursor: default;
    }
    .pointManagerHint {
      margin: 0;
      color: var(--mk-muted);
      font-size: 12px;
    }
    .fixtureTools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      border-top: 1px solid var(--mk-border);
      background: #101011;
    }
    .fixtureToolsText {
      min-width: 0;
      flex: 1 1 auto;
    }
    .fixtureToolsText strong {
      display: block;
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .fixtureToolsText span {
      display: block;
      color: var(--mk-muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .fixtureToolsText .fixtureError {
      color: #fca5a5;
    }
    .fixtureToolsActions {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .rows {
      display: grid;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(96px, 44%);
      gap: 12px;
      align-items: start;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: transparent;
    }
    .row:first-child {
      border-top: 0;
    }
    .row.cheapest {
      background: linear-gradient(90deg, rgba(34, 197, 94, 0.14), rgba(34, 197, 94, 0.03));
      box-shadow: inset 3px 0 0 var(--mk-success);
    }
    .row.failed {
      background: linear-gradient(90deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.03));
    }
    .row.unselected {
      opacity: 0.72;
    }
    .value {
      min-width: 0;
      text-align: right;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .value strong {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .value .original,
    .locationMeta {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .row.failed .value {
      max-width: 190px;
    }
    .failureActions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    @media (max-width: 430px) {
      .panel {
        width: calc(100vw - 18px);
      }
      .header {
        align-items: flex-start;
        flex-direction: column;
      }
      .headerTitle > span:last-child {
        max-width: 100%;
      }
      .headerActions {
        width: 100%;
        justify-content: flex-start;
      }
      .pointManagerTop,
      .detectedCandidatesTop {
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .pointManagerControls {
        flex-wrap: wrap;
      }
      .pointChoice,
      .detectedCandidate {
        align-items: flex-start;
      }
      .row {
        grid-template-columns: 1fr;
      }
      .value {
        max-width: none;
        text-align: left;
      }
      .failureActions {
        justify-content: flex-start;
      }
    }
  `;
}
