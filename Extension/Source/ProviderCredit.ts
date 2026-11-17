export type CreditPerson = { name: string; url?: string; title: string };
export type Credit = { provider: string; source?: string; people: CreditPerson[] };
type CreditLyrics = {
  Source?: { Provider: string };
  Attribution?: { Source: string; People: { Name: string; URL?: string; Role?: "Uploader" | "Maker" }[] };
};

export function BuildProviderCredit(lyrics: CreditLyrics | undefined): Credit | undefined {
  const id = lyrics?.Source?.Provider;
  if (!id) return undefined;
  const credit: Credit = { provider: id === "Spicy" ? "Spicy Lyrics" : id, people: [] };
  if (id !== "Spicy") return credit;
  const source = lyrics?.Attribution?.Source;
  if (source === "spicy_lyrics") {
    for (const person of lyrics!.Attribution!.People) {
      if (!person.Name.trim()) continue;
      const duplicate = credit.people.find(entry => entry.name === person.Name && entry.url === person.URL);
      if (duplicate) duplicate.title = `Uploader and maker: ${person.Name}`;
      else credit.people.push({ name: person.Name, url: person.URL,
        title: person.Role ? `${person.Role}: ${person.Name}` : person.Name });
    }
  } else {
    credit.source = !source || source === "unknown" ? "Unknown source"
      : source === "apple_music" ? "Apple Music" : source === "spotify" ? "Spotify"
      : source.replaceAll("_", " ").replace(/(^|\s)(\S)/gu, (_, space, letter) => space + letter.toUpperCase());
  }
  return credit;
}

// Both surfaces use these nodes. Ordering is a surface concern; text and link
// safety, separators and full-name tooltips have one owner.
export function BuildProviderCreditDOM(credit: Credit, order: "corner" | "card" | "provider" | "people" = "corner"): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const text = (className: string, value: string) => {
    const span = document.createElement("span"); span.className = className; span.textContent = value; return span;
  };
  const provider = text("BL-CreditProvider", credit.provider);
  const people = credit.people.map(person => {
    const node = person.url ? document.createElement("a") : document.createElement("span");
    node.className = "BL-CreditPerson"; node.textContent = person.name; node.title = person.title;
    if (person.url) {
      const link = node as HTMLAnchorElement;
      link.href = person.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    }
    return node;
  });
  const nodes = order === "provider" ? [provider] : order === "people" ? people
    : credit.source ? [text("BL-CreditSource", credit.source), provider]
    : order === "card" ? [...people, provider] : [provider, ...people];
  nodes.forEach((node, index) => {
    if (index) { const separator = text("BL-CreditSep", " \u00b7 "); separator.setAttribute("aria-hidden", "true"); fragment.append(separator); }
    fragment.append(node);
  });
  return fragment;
}
