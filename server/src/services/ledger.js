async function logActivity(db, { actorUserId = null, targetUserId = null, action, details = "" }) {
  await db.run(
    `
    INSERT INTO activity_logs (actor_user_id, target_user_id, action, details)
    VALUES (?, ?, ?, ?)
    `,
    [actorUserId, targetUserId, action, details]
  );
}

async function adjustCredits(db, { userId, delta, reason, createdBy = null }) {
  await db.run("UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE id = ?", [delta, userId]);
  await db.run(
    `
    INSERT INTO credit_transactions (user_id, delta, reason, created_by)
    VALUES (?, ?, ?, ?)
    `,
    [userId, delta, reason, createdBy]
  );
}

module.exports = {
  adjustCredits,
  logActivity
};
