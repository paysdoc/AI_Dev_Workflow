# Coding Guidelines

## Core Principles

1. **Clarity over cleverness** — Code should be easy to read and understand. Favor explicit over implicit. Use meaningful variable names and comments to explain non-obvious logic.
2. **Modularity** — Each unit (file, function, component) has a single responsibility. Keep files under 300 lines.
3. **Immutability** — Treat data as immutable. Create new values instead of mutating existing ones.
4. **Type safety** — Leverage the type system to catch errors at compile time, not runtime.
5. **Purity** — Prefer pure functions. Isolate side effects at the boundaries.
6. **Security by default** — Validate inputs, sanitize outputs, follow OWASP practices.

## General Practices

- **Error handling** — Use try-catch at system boundaries. Provide meaningful error messages.
- **Testing** — ADW itself does not use unit tests; agent-written unit tests are unreliable as quality gates because an agent can write tests that always pass, and they primarily test mocked implementations rather than real behaviour. BDD scenarios are ADW's validation mechanism. Unit tests remain available as an opt-in for target repos configured via `.adw/project.md`.
- **Performance** — Optimize critical paths (rendering, data processing). Profile before optimizing.
- **Security** — Validate inputs, use secure authentication, encrypt sensitive data. Regularly review code for vulnerabilities.

## TypeScript Practices

- **Strict mode** — Enable all strict compiler options (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`).
- **Avoid `any`** — Use specific types, generics, or `unknown`. Let strict mode enforce this.
- **Interfaces and types** — Define explicit types for data structures. Use interfaces for object shapes, type aliases for unions and intersections.
- **Type narrowing** — Use type guards and optional chaining over the `!` non-null assertion operator.
- **Utility types** — Leverage built-in utility types (`Readonly`, `Partial`, `Record`, `Pick`, `Omit`) to express intent clearly.
- **Enums** — Use enums for named constant sets. Avoid magic numbers and strings.
- **Generics** — Use generics for reusable components and functions that work across types.

## Nesting & Extraction

Deeply nested conditionals and loops ("sideways christmas tree") are a code smell. Flatten them.

- **Guard clauses** — handle invalid/edge cases first with early `return`, `continue`, or `throw`. The happy path stays at the leftmost indent.
- **Max depth ~2** — if a function has three or more levels of nested `if`/`for`/`try`, extract the inner block into a named function. The name documents intent better than the indentation hides it.
- **Extract loop bodies** — when a `for`/`map` body contains its own branching, lift the per-item logic into a named function and let the loop read as `items.map(processItem)`.
- **Invert conditions** — `if (!ok) return` beats wrapping the rest of the function in `if (ok) { ... }`.
- **One reason per function** — if you find yourself writing "and then, if X, also do Y" inside a branch, that branch wants its own function.

Extraction is justified by *reduced nesting and named intent*, not by line count or speculative reuse. A 5-line helper called once is fine if it replaces a 5-line nested block whose purpose was unclear.

## Functional Programming Practices

- **Declarative over imperative** — Use map, filter, reduce, and flatMap over for/while loops.
- **Composition** — Build complex operations by composing small, focused functions. Avoid deep nesting.
- **Isolate side effects** — Keep side effects (API calls, logging, DOM access) at the edges. Core logic should be pure: same input, same output, no external state.

## React & Next.js Practices

- **Component structure** — Prefer functional components. Keep components focused on a single UI concern.
- **Server vs. Client components** — Default to Server Components. Only add `"use client"` when you need interactivity, hooks, or browser APIs.
- **Hooks** — Extract reusable logic into custom hooks. Avoid deeply nested hook dependencies.
- **State management** — Keep state as local as possible. Lift state only when sibling components need it.
- **Data fetching** — Fetch data in Server Components where possible. Use Supabase client utilities from `src/lib/supabase.ts`.
- **Naming conventions** — PascalCase for components and their files (`UserProfile.tsx`). camelCase for utilities, hooks, and non-component files (`useAuth.ts`, `formatDate.ts`). kebab-case for directories (`user-profile/`).

## Process & Tooling

- **Version control** — Commit frequently with clear messages.
- **Continuous integration** — Automate testing and quality checks (e.g., GitHub Actions).
- **Formatting** — Use Prettier and ESLint for consistent style.
- **Code hygiene** — Remove unused variables, functions, and imports.
- **Documentation** — Document public APIs and non-obvious logic with JSDoc. Keep the README and setup instructions current.
