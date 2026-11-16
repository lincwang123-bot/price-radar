// Public labels only. Product ids, collector names and merchant titles stay put.
// Shops still write 5x / 20x / 25x, $100 / $200 / $500 and pro100; those strings
// are search aliases, not the names shown in navigation, titles or guides.
export const CHATGPT_PRO_PUBLIC_NAMES = Object.freeze({
  'chatgpt-pro-5x': 'ChatGPT Pro 100',
  'chatgpt-pro-20x': 'ChatGPT Pro 200',
  'chatgpt-pro-25x': 'ChatGPT Pro 500',
});

export const CHATGPT_PRO_SEARCH = Object.freeze({
  'chatgpt-pro-5x': '5x pro 5x pro5x pro100 $100 100刀 ChatGPT Pro 5x',
  'chatgpt-pro-20x': '20x pro 20x pro20x pro200 $200 200刀 ChatGPT Pro 20x',
  'chatgpt-pro-25x': '25x pro 25x pro25x pro500 $500 500刀 ChatGPT Pro 25x Pro 500',
});

export function chatgptProPublicName(id) {
  return CHATGPT_PRO_PUBLIC_NAMES[id] || '';
}
