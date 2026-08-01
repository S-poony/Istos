/** Maximum inline nesting depth before an entity is rendered as a compact collapsed summary. */
export const MAX_DEPTH = 3;

/**
 * Narrowest a card may be drawn, in CSS pixels.
 *
 * A grid's configured `columns` is a *maximum*, not a fixed count: the grid
 * uses as many columns as fit at this width and no more. Treating it as fixed
 * is what produced slivers — three columns inside three columns inside three
 * columns left each card a ninth of the window while its minimum height held
 * it tall, so the only thing a card could do as space ran out was get thinner.
 */
export const MIN_CARD_WIDTH = 132;

/**
 * Below this container width there is no room for even one legible card, so the
 * grid stops drawing cards and draws a list instead.
 *
 * This is the "collapse rather than squeeze" threshold. The alternative — a
 * card narrower than its own caption — costs more space than it conveys.
 */
export const DENSE_WIDTH = 150;

/**
 * How many children a *nested* container renders inline before deferring the
 * rest to a "show all" affordance.
 *
 * The focused container is never capped: it is the thing the user asked to
 * look at. Containers nested inside it are context, and a directory of 5,000
 * files rendered as context is 5,000 cards the user did not ask for.
 */
export const MAX_INLINE_CHILDREN = 24;

/**
 * How many focus targets stay mounted at once.
 *
 * Navigating into an entity and back must not re-decode every image and
 * re-parse every PDF that was already on screen, so previously visited views
 * stay in the DOM, hidden. They cannot stay forever — that is an unbounded
 * memory leak dressed up as a cache — so the least recently visited is dropped
 * past this count.
 */
export const MAX_LIVE_VIEWS = 6;

/**
 * How far outside the viewport content starts loading, as an
 * IntersectionObserver root margin. Large enough that a normal scroll never
 * shows an empty card, small enough that opening a large directory does not
 * load all of it.
 */
export const VISIBILITY_MARGIN = "400px";
