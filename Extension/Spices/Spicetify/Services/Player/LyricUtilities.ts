import type { Lyrics as ProviderLyrics } from "@Universal/Types/Lyrics.ts"
import { franc } from "npm:franc@^6.2.0"
export type { ProviderLyrics }
export type RomanizedLanguage = "Chinese" | "Japanese" | "Korean"
export type TransformedLyrics = ProviderLyrics & {
  NaturalAlignment: "Right" | "Left";
  Language: string;
  RomanizedLanguage?: RomanizedLanguage;
}
const rightToLeft = ['pes', 'urd', 'arb', 'uig', 'heb', 'ydd', 'men']

// Source preparation has no converter/tokenizer dependency. Availability is cheap
// metadata; only mounted consumers request derived text. Never mutate provider DTOs.
export const TransformProviderLyrics = async (providerLyrics: ProviderLyrics): Promise<TransformedLyrics> => {
  const lyrics = structuredClone(providerLyrics) as TransformedLyrics
  const texts: string[] = []
  if (lyrics.Type === "Static") for (const line of lyrics.Lines) {
    delete line.RomanizedText
    texts.push(line.Text)
  } else for (const group of lyrics.Content) {
    if (group.Type !== "Vocal") continue
    if ("Lead" in group) for (const voice of [group.Lead, ...(group.Background || [])]) {
      let text = ""
      voice.Syllables.forEach((span, index) => {
        delete span.RomanizedText
        text += span.Text
        // CURRENT IsPartOfWord means that span continues into NEXT.
        if (index + 1 < voice.Syllables.length && !span.IsPartOfWord) text += " "
      })
      texts.push(text)
    } else {
      delete group.RomanizedText
      texts.push(group.Text)
    }
  }
  const text = texts.join("\n")
  const language = franc(text)
  lyrics.Language = language
  lyrics.NaturalAlignment = rightToLeft.includes(language) ? "Right" : "Left"
  lyrics.RomanizedLanguage = /[ぁ-んァ-ン]/u.test(text) || (language === "jpn" && /\p{Script=Han}/u.test(text)) ? "Japanese"
    : /\p{Script=Hangul}/u.test(text) ? "Korean" : /\p{Script=Han}/u.test(text) ? "Chinese" : undefined
  return lyrics
}
