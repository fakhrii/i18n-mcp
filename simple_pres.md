# 🌍 `i18n-mcp` — The Smart Translation Engine for Apps & Websites

### What is `i18n-mcp`? (In Simple Terms)

When you build an app or a website, all the text (like _"Log In"_, _"Welcome back"_, or _"Add to cart"_) is usually written directly inside the code in a single language.

Translating that app into Spanish, French, Arabic, or Japanese normally requires a developer to spend **weeks manually finding every sentence, copying it into translation files, and rewriting the code**.

**`i18n-mcp` automates this entire process in minutes.** It works inside modern AI coding assistants (like Claude Code, Cursor, and Windsurf) to find user-facing text, organize it into clean translation dictionaries, and translate it naturally — without breaking your app.

---

## 🎯 What Does It Do? (Core Functionalities)

### 1. 🔍 Finds All Text Automatically

- Scans your entire project in seconds.
- Automatically identifies text that users actually see (buttons, headers, error messages, placeholders).
- Intelligently ignores technical code, database keys, styling, URLs, and sample dummy data.

### 2. ⚡ Rewrites Code Without Breaking Things

- Replaces fixed words in your code with dynamic multi-language tags (e.g. replacing `"Welcome"` with `t("welcome")`).
- Works safely across **Mobile Apps** (iOS Swift, Android, React Native, Flutter) and **Websites** (React, Next.js, Vue, Angular).

### 3. 🧠 Smart, Natural Translation

- Translates your text using advanced AI that understands context (for example, it knows whether _"Book"_ means a paperback novel or booking a flight).
- Maintains your brand tone, formality (polite vs. casual), and custom company terms.

### 4. 🔢 Handles Tricky Plurals & Grammar

- Many languages don't just have _"one"_ or _"many"_:
  - In English, you say _"1 item"_ and _"2 items"_.
  - In Russian, words change across 4 different quantity rules.
  - In Arabic, there are 6 distinct plural forms!
- `i18n-mcp` automatically sets up the right grammar rules for each language so your app never shows broken sentences like _"1 items"_.

### 5. ↔️ Prepares Layouts for Arabic & Hebrew (RTL)

- Right-to-Left (RTL) languages require screens, buttons, and navigation arrows to flip direction.
- The tool inspects your app and warns you if hardcoded _"left"_ or _"right"_ alignments will look broken for Arabic or Hebrew speakers.

### 6. 🧹 Cleans Up Duplicates

- Finds repetitive sentences across different screens (e.g., _"Save changes"_, _"Save Changes"_, _"Save changes."_).
- Merges them into a single reusable translation, keeping your app lightweight and consistent.

### 7. 🤝 Connects with Professional Translation Agencies

- If your company works with external human translators, it exports your text into industry-standard formats (**XLIFF**).
- Once the agency translates the files, you re-import them with a single click.

---

## 💎 The Strong Points (Why It’s a Game Changer)

| Strong Point                        | Why It Matters to Your Team                                                                                                                                  |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⏱️ **Weeks of Work in 5 Minutes**   | Eliminates the single most boring, repetitive task in software development. Launches your app globally much faster.                                          |
| 🛡️ **100% Safe (Preview First)**    | It never touches your files without permission. It always provides a clear preview of every change before applying it.                                       |
| 🧩 **No Broken Screens**            | Standard AI often breaks code when trying to rewrite UI files directly. `i18n-mcp` uses strict code safety rules so your app builds and runs without errors. |
| 📱 **One Tool for Everything**      | Whether you have an iPhone app, an Android app, or a web dashboard, you use the exact same tool.                                                             |
| 💰 **Zero Extra Translation Costs** | Uses the AI you are already using (like Claude in Claude Code) directly in the chat, saving you expensive translation API subscriptions.                     |

---

## 🚀 How Anyone Can Use It (In 3 Simple Steps)

You don't need complex terminal commands. You just talk to your AI assistant:

1. **Scan your app:**
   > _"Internationalize this screen and preview what needs translation"_
2. **Review the preview:**
   > The AI shows you a list of words it found and the proposed translations.
3. **Apply & Translate:**
   > _"Looks great, apply the changes and translate to French and Spanish"_
