// §5: DOM extraction contracts. Phase A produces SkeletonNodes (structure only,
// §5.1 — "reads no text, runs no sanitization"); Phase B sanitizes the content
// fields Phase A pointed at (as ContentUnits) and the assembler merges them back
// by (node_id, field) into SanitizedNodes for SanitizedObservation.dom (§14).

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeState {
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  readonly?: boolean;
  required?: boolean;
  expanded?: boolean;
}

// Whitelisted semantic class flags (§5.5) — never raw class strings.
export type SemanticFlag = 'error' | 'disabled' | 'active' | 'hidden';

// §5.1: only `type`/`name` are read as plain attrs. `href`/`src`/`placeholder`
// carry content and are tracked as ContentFields instead (Phase B sanitized).
export interface SkeletonAttrs {
  type?: string;
  name?: string;
}

export type ContentField = 'accessible_name' | 'href' | 'src' | 'placeholder' | 'text' | 'value';

// Boundary exclusions that must leave a marker rather than being silently
// omitted (§2.10, §5.1, §6.1).
export type ExclusionMarker =
  | 'iframe_skipped'
  | 'shadow_closed_skipped'
  | 'canvas_skipped'
  | 'svg_skipped'
  | 'video_skipped';

// §6.1/§6.2/§6.4/§14.3: why an image node's pixels were left out of the
// observation. `too_small` (§6.1's size floor) was added in M8 -- M2 only
// listed the §14.3 reasons.
export type ImageOmittedReason = 'too_small' | 'unreadable' | 'detector_failed' | 'request_limit';

// §6.1: which kind of image a node carries -- an <img> (incl. srcset/
// <picture>, via currentSrc) or a CSS `background-image: url(...)`. A
// structural fact set in Phase A (no pixels, no URL -- the URL is content
// and only ever travels content script -> compute host, never to a backend).
export type ImageKind = 'img' | 'background';

export interface SkeletonNode {
  node_id: string;
  tag: string;
  node_type: 'element' | 'text';
  parent_id: string | null;
  role?: string;
  bbox: BBox;
  visible: boolean;
  in_viewport: boolean;
  state?: NodeState;
  scroll_parent?: string;
  attrs?: SkeletonAttrs;
  flags?: SemanticFlag[];
  secret?: boolean;
  marker?: ExclusionMarker;
  image?: ImageKind;
  image_omitted?: ImageOmittedReason;
  // §13.4 rule 4: the origin of the enclosing <form>'s `action`, if any --
  // a plain structural fact (not page content, not PII), so it's captured
  // directly in Phase A rather than routed through Phase B sanitization.
  form_action_origin?: string;
  // §7.5: structural context for the public-vs-private email heuristic,
  // computed in Phase A (no content read). Only set on content-bearing nodes.
  context_hints?: ContextHints;
  // M12 (§14.2): content under or on this node was left out for the budget
  // (src/dom/contentBudget.ts) -- never read into a unit, never sent. The
  // observation also carries `truncated: true`. Scrolling there brings it
  // into the viewport, which the budget ranks first.
  trimmed?: boolean;
  // Fields captured in Phase A whose sanitized text is still pending from
  // Phase B; resolved into `SanitizedNode.content` by (node_id, field).
  pending_content: ContentField[];
}

export interface SanitizedNode extends Omit<SkeletonNode, 'pending_content'> {
  content: Partial<Record<ContentField, string>>;
}

// §7.5: node context the compute host can't see on its own, attached in Phase A.
export interface ContextHints {
  in_landmark: boolean;
  near_contact_heading: boolean;
  in_contact_markup: boolean;
  in_ugc_block: boolean;
}

export interface ContentUnit {
  unit_id: string;
  node_id: string;
  field: ContentField;
  text: string;
  context?: ContextHints;
}
