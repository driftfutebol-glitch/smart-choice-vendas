const DAY_MS = 24 * 60 * 60 * 1000;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isBeginnerAccount(createdAt, beginnerDays) {
  if (!createdAt) return false;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const maxAge = beginnerDays * DAY_MS;
  return ageMs <= maxAge;
}

function monthRef(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

module.exports = {
  addMinutes,
  generateCode,
  isBeginnerAccount,
  monthRef,
  nowIso
};
