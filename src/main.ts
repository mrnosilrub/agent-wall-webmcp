export {};

const app = document.querySelector<HTMLElement>("#app");

if (app === null) throw new Error("missing #app");
app.replaceChildren();
const title = document.createElement("h1");
title.textContent = "Agent Wall";
const statusText = document.createElement("p");
statusText.textContent = "Fixture-safe WebMCP challenge surface.";
app.append(title, statusText);
