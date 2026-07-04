import { createTranslator, resolveLanguage } from "../../src/shared/i18n";

describe("i18n", () => {
  it("uses Russian by default", () => {
    const i18n = createTranslator();

    expect(i18n.language).toBe("ru");
    expect(i18n.t("optionsLanguageHeading")).toBe("Язык");
  });

  it("resolves auto language from the browser UI language", () => {
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage("auto", "ru-RU")).toBe("ru");
  });

  it("falls back to Russian when auto detection finds an unsupported language", () => {
    expect(resolveLanguage("auto", "de-DE")).toBe("ru");
  });

  it("formats message parameters", () => {
    expect(createTranslator("en").t("panelSaved", { name: "Astana pickup" })).toBe("Saved: Astana pickup");
  });
});
