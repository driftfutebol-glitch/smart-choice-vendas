const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Token invalido" });
  }
}

function adminRequired(req, res, next) {
  if (!req.auth || req.auth.role !== "ADMIN") {
    return res.status(403).json({ error: "Acesso restrito ao admin" });
  }

  return next();
}

module.exports = {
  signToken,
  authRequired,
  adminRequired
};
