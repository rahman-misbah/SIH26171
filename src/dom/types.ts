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

// §14.3: why an image node's pixels were left out of the observation.
export type ImageOmittedReason = 'unreadable' | 'detector_failed' | 'request_limit';

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
  image_omitted?: ImageOmittedReason;
  // §13.4 rule 4: the origin of the enclosing <form>'s `action`, if any --
  // a plain structural fact (not page content, not PII), so it's captured
  // directly in Phase A rather than routed through Phase B sanitization.
  form_action_origin?: string;
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
