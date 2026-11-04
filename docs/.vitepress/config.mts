import { defineConfig } from "vitepress";

const repo = "https://github.com/minhpham1810/umbra";
const site = "https://minhpham1810.github.io/umbra";

export default defineConfig({
  title: "Umbra",
  description: "A deterministic 2D and 3D game engine in TypeScript, built for AI agents.",
  base: "/umbra/",
  cleanUrls: true,
  lastUpdated: true,
  // README.md is the folder's index on GitHub; index.md is the site's home.
  srcExclude: ["README.md"],
  head: [["link", { rel: "icon", href: "/umbra/favicon.svg", type: "image/svg+xml" }]],
  themeConfig: {
    logo: "/favicon.svg",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Playground", link: `${site}/playground/`, target: "_blank" },
      { text: "Studio", link: `${site}/studio/`, target: "_blank" },
      { text: "Changelog", link: `${repo}/blob/main/CHANGELOG.md` },
      { text: "npm", items: [
        { text: "umbra-engine", link: "https://www.npmjs.com/package/umbra-engine" },
        { text: "umbra-agents", link: "https://www.npmjs.com/package/umbra-agents" },
      ] },
    ],
    sidebar: [
      { text: "Guide", items: [
        { text: "Getting started", link: "/getting-started" },
        { text: "In the browser", link: "/browser" },
        { text: "Physics", link: "/physics" },
        { text: "Agents", link: "/agents" },
        { text: "Determinism", link: "/determinism" },
      ] },
      { text: "Try it", items: [
        { text: "Playground", link: `${site}/playground/` },
        { text: "Studio (replays)", link: `${site}/studio/` },
        { text: "Examples (source)", link: `${repo}/tree/main/packages/engine/examples` },
      ] },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
    outline: [2, 3],
    footer: { message: "MIT licensed.", copyright: "Umbra" },
  },
});
