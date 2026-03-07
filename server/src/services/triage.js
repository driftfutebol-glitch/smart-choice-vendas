function triageFaq(question, faqRows) {
  const normalized = (question || "").toLowerCase();

  for (const row of faqRows) {
    const keywords = (row.keywords || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const matched = keywords.some((keyword) => normalized.includes(keyword));
    if (matched) {
      return {
        resolved: true,
        answer: row.answer,
        faqQuestion: row.question
      };
    }
  }

  return {
    resolved: false,
    answer: "Nao encontrei uma resposta precisa no FAQ. Vou abrir um ticket para atendimento humano."
  };
}

module.exports = {
  triageFaq
};
