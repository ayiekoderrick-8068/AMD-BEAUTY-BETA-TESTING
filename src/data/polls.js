// The three launch-poll questions. Votes are stored by option label.
export const polls = [
  {
    id: "q1",
    text: "Which shade is your favourite?",
    options: [
      { label: "Raspberry Jelly", hint: "Raspberry pink", swatch: "linear-gradient(135deg,#e8517f,#d6245a)" },
      { label: "Toast", hint: "Warm peach nude", swatch: "linear-gradient(135deg,#e8b09c,#d98c74)" },
      { label: "Mocha", hint: "Chocolate brown", swatch: "linear-gradient(135deg,#a05a45,#7a3a2a)" },
      { label: "Ribbon", hint: "Soft baby pink", swatch: "linear-gradient(135deg,#fadbe3,#f08aa6)" },
    ],
  },
  {
    id: "q2",
    text: "What matters most in a lip product?",
    options: [
      { label: "Long-lasting", hint: "Stays fresh all day", icon: "clock" },
      { label: "Moisturizing", hint: "Keeps lips soft", icon: "drop" },
      { label: "Colour payoff", hint: "Rich and vibrant colour", icon: "sparkle" },
    ],
  },
  {
    id: "q3",
    text: "How likely are you to buy it?",
    options: [
      { label: "Definitely", hint: "I'm getting it", icon: "heart" },
      { label: "Probably", hint: "Most likely", icon: "thumb" },
      { label: "Not sure", hint: "Need more info", icon: "question" },
    ],
  },
];
