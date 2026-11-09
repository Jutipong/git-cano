// Additions to Vue's DOM attribute typings for TS 7 + @vue/content-mapper
// checks that vue-tsc swallowed:
// - pattern-matched `data-*` attributes (valid on any HTML/SVG element)
// - `title` on SVG elements (tooltip)
// - `strokeWidth` — content-mapper camelizes kebab SVG attrs during codegen
// - `role`/`title` on Transition/TransitionGroup (fall-through to the rendered
//   `tag`; the repo's app shell relies on it for the tab list a11y tree)
import 'vue'

declare module 'vue' {
    interface HTMLAttributes {
        [key: `data-${string}`]: unknown
    }
    interface SVGAttributes {
        [key: `data-${string}`]: unknown
        title?: string | undefined
        strokeWidth?: string | number | undefined
    }
    interface BaseTransitionProps {
        role?: string
        title?: string
        [key: `aria-${string}`]: unknown
    }
}
