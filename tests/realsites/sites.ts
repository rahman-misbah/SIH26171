// M12 real-site pass: public pages, visited logged out on a fresh profile.
// One per kind of page the demo might meet (user-approved list, M12 plan).
// Only counts and timings are ever recorded from them (summarize.ts).

export interface RealSite {
  id: string;
  category: string;
  url: string;
}

export const REAL_SITES: RealSite[] = [
  { id: 'wikipedia', category: 'article, images', url: 'https://en.wikipedia.org/wiki/Indian_Space_Research_Organisation' },
  { id: 'duckduckgo', category: 'search results', url: 'https://html.duckduckgo.com/html/?q=chandrayaan+3' },
  { id: 'thehindu', category: 'news', url: 'https://www.thehindu.com/' },
  { id: 'isro', category: 'government', url: 'https://www.isro.gov.in/' },
  { id: 'indiagov', category: 'government portal', url: 'https://www.india.gov.in/' },
  { id: 'github-login', category: 'login form (secret field)', url: 'https://github.com/login' },
  { id: 'github-profile', category: 'profile, avatar', url: 'https://github.com/torvalds' },
  {
    id: 'stackoverflow',
    category: 'Q&A, user content',
    url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
  },
  { id: 'flipkart', category: 'e-commerce listing', url: 'https://www.flipkart.com/search?q=laptop' },
  { id: 'httpbin-form', category: 'plain form', url: 'https://httpbin.org/forms/post' },
  { id: 'youtube-embed', category: 'iframe embed', url: 'https://developers.google.com/youtube/iframe_api_reference' },
];
