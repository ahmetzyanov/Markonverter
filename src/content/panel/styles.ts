export function panelCss(): string {
  return `
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      container-type: inline-size;
      color-scheme: light;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      letter-spacing: 0;
      --mk-bg: #f5f7fa;
      --mk-surface: #ffffff;
      --mk-surface-2: #f7f9fc;
      --mk-surface-3: #eef3fa;
      --mk-border: #dce3ee;
      --mk-border-strong: #c7d1de;
      --mk-text: #17233c;
      --mk-muted: #53627a;
      --mk-quiet: #7b8798;
      --mk-disabled: #a6b0bf;
      --mk-accent: #005bff;
      --mk-accent-hover: #004ce0;
      --mk-accent-pressed: #003fb8;
      --mk-accent-soft: #eaf2ff;
      --mk-accent-border: #b8d2ff;
      --mk-success: #10a35a;
      --mk-success-soft: #eaf8f1;
      --mk-danger: #e5484d;
      --mk-danger-soft: #fff0f0;
      --mk-warning: #f59f00;
      --mk-warning-soft: #fff6e0;
      --mk-info: #005bff;
    }
    * {
      box-sizing: border-box;
    }
    .panel {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      margin: 12px 0;
      border: 1px solid var(--mk-border);
      border-top: 3px solid var(--mk-accent);
      border-radius: 8px;
      background: var(--mk-surface);
      overflow: hidden;
      font-size: 13px;
      line-height: 1.35;
      z-index: 2147483647;
      color: var(--mk-text);
      transform-origin: top right;
      transition:
        max-width 220ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 180ms ease,
        border-color 180ms ease;
    }
    .floating {
      position: fixed;
      top: 84px;
      right: 16px;
      max-width: min(398px, calc(100vw - 24px));
      box-shadow: 0 8px 28px rgba(23, 35, 60, 0.14);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      border-bottom: 1px solid var(--mk-border);
      background: var(--mk-surface);
    }
    .headerTitle {
      min-width: 0;
    }
    .eyebrow {
      display: block;
      margin: 0 0 5px;
      color: var(--mk-accent);
      font-size: 11px;
      line-height: 1;
      font-weight: 720;
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
      max-width: 100%;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .header .eyebrow,
    .pointManagerTop .eyebrow,
    .detectedCandidatesTop .eyebrow {
      margin: 0 0 5px;
      color: var(--mk-accent);
      font-size: 11px;
      line-height: 1;
      font-weight: 720;
    }
    .headerActions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .secondaryButton,
    .iconButton {
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--mk-accent);
      border-radius: 8px;
      background: var(--mk-accent);
      color: #ffffff;
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
      border-color: var(--mk-accent-hover);
    }
    button:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(0, 91, 255, 0.16);
    }
    button:active:not(:disabled) {
      transform: translateY(1px);
    }
    .secondaryButton {
      border-color: var(--mk-border-strong);
      background: var(--mk-surface);
      color: var(--mk-accent);
    }
    .iconButton {
      border: 1px solid var(--mk-border-strong);
      background: var(--mk-surface);
      color: var(--mk-muted);
      cursor: pointer;
    }
    .secondaryButton:hover:not(:disabled),
    .iconButton:hover:not(:disabled) {
      border-color: var(--mk-accent-border);
      background: var(--mk-accent-soft);
      color: var(--mk-accent);
    }
    .settingsButton {
      width: 32px;
      padding: 0;
      font-size: 17px;
      line-height: 1;
    }
    .collapseButton {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      padding: 0;
    }
    .chevronIcon {
      width: 9px;
      height: 9px;
      border: solid currentColor;
      border-width: 0 2px 2px 0;
    }
    .chevronDown {
      transform: translateY(-2px) rotate(45deg);
    }
    .chevronUp {
      transform: translateY(2px) rotate(-135deg);
    }
    .message {
      margin: 0;
      padding: 12px 14px;
      color: var(--mk-muted);
      overflow-wrap: anywhere;
    }
    .message.error {
      color: var(--mk-danger);
    }
    .capture {
      display: grid;
      gap: 7px;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: var(--mk-surface-2);
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
      color: #ffffff;
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
      background: var(--mk-surface-2);
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
    .detectedHeaderActions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 7px;
      flex: 0 0 auto;
    }
    .detectedToggleButton {
      min-height: 28px;
      width: 28px;
      padding: 0;
    }
    .detectedToggleButton .chevronIcon {
      display: inline-block;
      margin: 0;
      color: inherit;
    }
    .detectedCandidatesBody {
      display: grid;
      gap: 8px;
    }
    .detectedCandidates.collapsed {
      gap: 0;
    }
    .pointManagerControls button,
    .deleteButton,
    .saveSmallButton,
    .detailsButton,
    .confirmButton {
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
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .rowHoverActions {
      display: flex;
      justify-content: flex-end;
      flex: 0 0 24px;
      width: 24px;
      min-height: 24px;
    }
    .rowDeleteButton {
      min-height: 24px;
      width: 24px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 140ms ease,
        visibility 140ms ease,
        border-color 150ms ease,
        background 150ms ease;
    }
    .row:hover .rowDeleteButton,
    .row:focus-within .rowDeleteButton {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }
    .deleteButton {
      border-color: var(--mk-danger);
      color: var(--mk-danger);
      background: var(--mk-surface);
    }
    .saveSmallButton {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: #ffffff;
    }
    .detailsButton {
      border-color: var(--mk-border-strong);
      color: var(--mk-muted);
      background: var(--mk-surface);
    }
    .confirmButton.danger {
      border-color: var(--mk-danger);
      background: var(--mk-danger);
      color: #ffffff;
      font-weight: 750;
    }
    .saveSmallButton:disabled {
      border-color: var(--mk-border);
      color: var(--mk-quiet);
      background: var(--mk-surface-2);
      cursor: default;
    }
    .panelConfirmation {
      display: grid;
      gap: 10px;
      padding: 12px 14px;
      border-top: 1px solid var(--mk-border);
      background: var(--mk-surface-2);
    }
    .panelConfirmation.danger {
      box-shadow: inset 3px 0 0 var(--mk-danger);
    }
    .panelConfirmationText {
      min-width: 0;
    }
    .panelConfirmationText strong {
      display: block;
      color: var(--mk-text);
      font-size: 12px;
      font-weight: 730;
    }
    .panelConfirmationText span {
      display: block;
      margin-top: 3px;
      color: var(--mk-muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .panelConfirmationActions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: wrap;
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
      background: var(--mk-surface-2);
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
      color: var(--mk-danger);
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
      background: var(--mk-success-soft);
      box-shadow: inset 3px 0 0 var(--mk-success);
    }
    .row.failed {
      background: var(--mk-surface);
    }
    .row.warning {
      background: var(--mk-surface);
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
      font-size: 14px;
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .value .original {
      font-variant-numeric: tabular-nums;
    }
    .row.failed .value {
      max-width: 190px;
      padding: 8px;
      border: 1px solid rgba(229, 72, 77, 0.24);
      border-radius: 8px;
      background: var(--mk-danger-soft);
    }
    .row.warning .value {
      max-width: 230px;
      padding: 8px;
      border: 1px solid rgba(245, 159, 0, 0.34);
      border-radius: 8px;
      background: var(--mk-warning-soft);
    }
    .row.warning .value strong {
      color: #875600;
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
    @container (max-width: 330px) {
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
