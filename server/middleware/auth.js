import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const config = loadConfig();
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded; // { id, publicKey }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
