// backend/src/services/database.chats.ts

import sqlite3 from 'sqlite3';
import { MAX_CHAT_CHARS } from './database';
import { User } from './database.types';

/* Classe gérant toutes les opérations liées au chat et aux notifications */
export class ChatOperations {
	constructor(private db: sqlite3.Database) {}

	/* Helpers SQLite */
	private dbGet(query: string, params: any[] = []): Promise<any> { 
		return new Promise((resolve, reject) => { 
			this.db.get(query, params, (err, row) => {
				if (err) reject(new Error(`Database query failed: ${err.message}`));
				else resolve(row);
			});
		});
	}

	private dbRun(query: string, params: any[] = []): Promise<{ lastID: number; changes: number }> { 
		return new Promise((resolve, reject) => { 
			this.db.run(query, params, function (err) { 
				if (err) reject(new Error(`Database operation failed: ${err.message}`));
				else resolve({ lastID: this.lastID, changes: this.changes });
			});
		});
	}

	private dbAll(query: string, params: any[] = []): Promise<any[]> { 
		return new Promise((resolve, reject) => { 
			this.db.all(query, params, (err, rows) => {
				if (err) reject(new Error(`Database query failed: ${err.message}`));
				else resolve(rows || []);
			});
		});
	}

	/* CONVERSATIONS */
	async getOrCreatePrivateConversation(user1Id: number, user2Id: number): Promise<number> {
		const existing = `SELECT c.id FROM conversations c JOIN conversation_participants cp1 ON c.id = cp1.conversation_id JOIN conversation_participants cp2 ON c.id = cp2.conversation_id WHERE c.type='private' AND cp1.user_id=? AND cp2.user_id=?`;
		try {
			let conv = await this.dbGet(existing, [user1Id, user2Id]) || await this.dbGet(existing, [user2Id, user1Id]);
			if (conv) return conv.id;
			const c = await this.dbRun('INSERT INTO conversations (type) VALUES ("private")'); 
			const conversationId = c.lastID;
			await this.dbRun('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [conversationId, user1Id]);
			await this.dbRun('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [conversationId, user2Id]);
			return conversationId;
		} catch (e) { console.error('[DB] getOrCreatePrivateConversation error:', e); throw e; }
	}
	
	/* Envoie un message avec flag sent_while_blocked */
	async sendMessage(
		conversationId: number, 
		senderId: number, 
		content: string, 
		messageType: string = 'text', 
		metadata?: string,
		sentWhileBlocked: boolean = false
	): Promise<number> {
		const trimmed = (content ?? '').trim();
		if (trimmed.length === 0) throw new Error('Message content cannot be empty');
		if (trimmed.length > MAX_CHAT_CHARS) throw new Error(`Message too long (max ${MAX_CHAT_CHARS} characters)`);

		const q = `INSERT INTO messages (conversation_id, sender_id, message_type, content, metadata, sent_while_blocked) VALUES (?, ?, ?, ?, ?, ?)`;
		try { 
			const r = await this.dbRun(q, [
				conversationId, 
				senderId, 
				messageType, 
				trimmed, 
				metadata,
				sentWhileBlocked ? 1 : 0
			]); 
			
			console.log('[DB] Message saved:', {
				id: r.lastID,
				conversationId,
				senderId,
				messageType,
				sentWhileBlocked
			});
			
			return r.lastID;
		} catch (e: any) {
			if (typeof e?.message === 'string' && e.message.includes('CHECK constraint failed')) {
				throw new Error(`Message too long (max ${MAX_CHAT_CHARS} characters)`);
			}
			console.error("[DB] sendMessage error:", e); 
			throw e;
		}
	}

	/* Récupère les messages en filtrant UNIQUEMENT par blocage utilisateur */
	async getMessages(conversationId: number, userId: number, limit: number = 50, offset: number = 0): Promise<any[]> {
		// Vérifier l'accès pour les conversations privées
		if (conversationId !== 1) {
			const ok = await this.dbGet('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [conversationId, userId]);
			if (!ok) throw new Error('Access denied to this conversation');
		}
		
		// Filtrer UNIQUEMENT les messages des utilisateurs bloqués PAR l'utilisateur connecté
		// Ne pas filtrer par sent_while_blocked car cela cache aussi les messages système/tournoi
		const q = `
			SELECT 
				m.id, 
				m.message_type, 
				m.content, 
				m.metadata, 
				m.created_at, 
				u.id as sender_id, 
				u.username as sender_username, 
				u.avatar_url as sender_avatar,
				m.sent_while_blocked
			FROM messages m 
			JOIN users u ON m.sender_id = u.id 
			WHERE m.conversation_id = ? 
				AND NOT EXISTS (
					SELECT 1 FROM blocked_users bu 
					WHERE bu.blocker_id = ? AND bu.blocked_id = m.sender_id
				)
			ORDER BY m.created_at DESC 
			LIMIT ? OFFSET ?`;
		
		try { 
			const msgs = await this.dbAll(q, [conversationId, userId, limit, offset]); 
			console.log('[DB] Messages retrieved:', {
				conversationId,
				count: msgs.length,
				userId,
				filteredByUserBlock: true,
				oldest: msgs.length > 0 ? msgs[msgs.length - 1]?.created_at : null,
				newest: msgs.length > 0 ? msgs[0]?.created_at : null
			});
			return msgs.reverse();
		} catch (e) { 
			console.error('[DB] getMessages error:', e); 
			return []; 
		}
	}

	async getUserConversations(userId: number): Promise<any[]> {
		const q = `SELECT c.id, c.type FROM conversations c JOIN conversation_participants cp ON c.id = cp.conversation_id WHERE cp.user_id = ? AND c.id != 1 ORDER BY c.created_at DESC`;
		try {
			const conversations = await this.dbAll(q, [userId]);
			for (const conv of conversations) {
				if (conv.type === 'private') {
					conv.participants = await this.dbAll(`SELECT cp.user_id, u.username FROM conversation_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.conversation_id = ?`, [conv.id]);
				}
			}
			return conversations;
		} catch (e) { console.error('[DB] getUserConversations error:', e); return []; }
	}

	async getLastUserMessage(userId: number, conversationId: number): Promise<any> {
		try { return await this.dbGet('SELECT * FROM messages WHERE sender_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 1', [userId, conversationId]); } 
		catch (e) { console.error('[DB] getLastUserMessage error:', e); return null; }
	}

	/* BLOCKING */
	async blockUser(blockerId: number, blockedId: number, reason?: string): Promise<void> {
		if (blockerId === blockedId) throw new Error('Cannot block yourself');
		try { await this.dbRun('INSERT OR REPLACE INTO blocked_users (blocker_id, blocked_id, reason) VALUES (?, ?, ?)', [blockerId, blockedId, reason]); } 
		catch (e) { console.error('[DB] blockUser error:', e); throw e; }
	}

	async unblockUser(blockerId: number, blockedId: number): Promise<void> {
		try { 
			const r = await this.dbRun('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]); 
			if (!r.changes) throw new Error('User was not blocked');
		} catch (e) { console.error('[DB] unblockUser error:', e); throw e; }
	}

	async isUserBlocked(userId: number, otherUserId: number): Promise<boolean> {
		try { return !!(await this.dbGet(`SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`, [userId, otherUserId])); } 
		catch (e) { console.error('[DB] isUserBlocked error:', e); return false; }
	}

	async getBlockedUsers(userId: number): Promise<User[]> {
		try { return await this.dbAll(`SELECT u.id, u.username, u.avatar_url FROM blocked_users b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ? ORDER BY u.username`, [userId]); } 
		catch (e) { console.error('[DB] getBlockedUsers error:', e); return []; }
	}

	/* NOTIFICATIONS */
	async createNotification(userId: number, type: string, title: string, message: string, metadata?: string): Promise<number> {
		try { 
			const r = await this.dbRun('INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)', [userId, type, title, message, metadata]); 
			return r.lastID;
		} catch (e) { console.error('[DB] createNotification error:', e); throw e; }
	}

	async getUserNotifications(userId: number, limit: number = 20, unreadOnly: boolean = false): Promise<any[]> {
		let sql = 'SELECT * FROM notifications WHERE user_id = ?';
		if (unreadOnly) sql += ' AND is_read = 0';
		sql += ' ORDER BY created_at DESC LIMIT ?';
		try { return await this.dbAll(sql, [userId, limit]); } 
		catch (e) { console.error('[DB] getUserNotifications error:', e); return []; }
	}

	async getUnreadNotificationCount(userId: number): Promise<number> {
		try { const r = await this.dbGet('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [userId]); return r?.count || 0; } 
		catch (e) { console.error('[DB] getUnreadNotificationCount error:', e); return 0; }
	}

	async markNotificationAsRead(notificationId: number, userId: number): Promise<void> {
		try { await this.dbRun('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [notificationId, userId]); } 
		catch (e) { console.error('[DB] markNotificationAsRead error:', e); throw e; }
	}

	async markAllNotificationsAsRead(userId: number): Promise<void> {
		try { await this.dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]); } 
		catch (e) { console.error('[DB] markAllNotificationsAsRead error:', e); throw e; }
	}

	/* FRIEND REQUESTS */
	async createFriendRequest(requesterId: number, requestedId: number, message?: string): Promise<number> {
		try {
			const existing = await this.dbGet('SELECT id FROM friend_requests WHERE (requester_id = ? AND requested_id = ?) OR (requester_id = ? AND requested_id = ?)', [requesterId, requestedId, requestedId, requesterId]);
			if (existing) throw new Error('Friend request already exists between these users');
			const r = await this.dbRun('INSERT INTO friend_requests (requester_id, requested_id, message) VALUES (?, ?, ?)', [requesterId, requestedId, message]);
			return r.lastID;
		} catch (e) { console.error('[DB] createFriendRequest error:', e); throw e; }
	}

	async createGameChallenge(challengerId: number, challengedId: number, message?: string, gameMode: string = 'classic'): Promise<number> {
		try { 
			const r = await this.dbRun('INSERT INTO game_challenges (challenger_id, challenged_id, message, game_mode) VALUES (?, ?, ?, ?)', [challengerId, challengedId, message, gameMode]); 
			return r.lastID;
		} catch (e) { console.error('[DB] createGameChallenge error:', e); throw e; }
	}

	/* MESSAGE READS */
	async markMessageAsRead(messageId: number, userId: number): Promise<void> {
		try {
			await this.dbRun('INSERT OR IGNORE INTO chat_message_reads (message_id, user_id) VALUES (?, ?)', [messageId, userId]);
		} catch (e) {
			console.error('[DB] markMessageAsRead error:', e);
			throw e;
		}
	}

	async markConversationMessagesAsRead(conversationId: number, userId: number): Promise<void> {
		try {
			await this.dbRun(`INSERT OR IGNORE INTO chat_message_reads (message_id, user_id) SELECT m.id, ? FROM messages m WHERE m.conversation_id = ? AND m.sender_id != ?`, [userId, conversationId, userId]);
		} catch (e) {
			console.error('[DB] markConversationMessagesAsRead error:', e);
			throw e;
		}
	}

	async markUserMessagesAsRead(currentUserId: number, otherUserId: number): Promise<void> {
		try {
			const conversation = await this.getOrCreatePrivateConversation(currentUserId, otherUserId);
			await this.dbRun(`INSERT OR IGNORE INTO chat_message_reads (message_id, user_id) SELECT m.id, ? FROM messages m WHERE m.conversation_id = ? AND m.sender_id = ?`, [currentUserId, conversation, otherUserId]);
		} catch (e) {
			console.error('[DB] markUserMessagesAsRead error:', e);
			throw e;
		}
	}

	/* Compteurs de messages non lus (exclut UNIQUEMENT les messages des utilisateurs bloqués) */
	async getUnreadChatCounts(userId: number): Promise<Array<{ userId: number; username: string; count: number; lastMessageTime: string }>> {
		try {
			// Filtrer uniquement par blocked_users, pas par sent_while_blocked
			const query = `
				SELECT 
					sender.id as userId, 
					sender.username, 
					COUNT(*) as count, 
					MAX(m.created_at) as lastMessageTime
				FROM messages m
				JOIN users sender ON m.sender_id = sender.id
				JOIN conversation_participants cp1 ON m.conversation_id = cp1.conversation_id
				WHERE cp1.user_id = ? 
					AND m.sender_id != ? 
					AND m.conversation_id != 1
					AND NOT EXISTS (
						SELECT 1 FROM blocked_users bu 
						WHERE bu.blocker_id = ? AND bu.blocked_id = m.sender_id
					)
					AND NOT EXISTS (
						SELECT 1 FROM chat_message_reads cmr 
						WHERE cmr.message_id = m.id AND cmr.user_id = ?
					)
				GROUP BY sender.id, sender.username
				ORDER BY lastMessageTime DESC
			`;

			return await this.dbAll(query, [userId, userId, userId, userId]);
		} catch (e) {
			console.error('[DB] getUnreadChatCounts error:', e);
			return [];
		}
	}

	/* Total messages non lus (exclut UNIQUEMENT les messages des utilisateurs bloqués) */
	async getTotalUnreadChatCount(userId: number): Promise<number> {
		try {
			// ✅ CORRECTION : Filtrer uniquement par blocked_users, pas par sent_while_blocked
			const result = await this.dbGet(`
				SELECT COUNT(*) as count
				FROM messages m
				JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
				WHERE cp.user_id = ? 
					AND m.sender_id != ? 
					AND m.conversation_id != 1
					AND NOT EXISTS (
						SELECT 1 FROM blocked_users bu 
						WHERE bu.blocker_id = ? AND bu.blocked_id = m.sender_id
					)
					AND NOT EXISTS (
						SELECT 1 FROM chat_message_reads cmr 
						WHERE cmr.message_id = m.id AND cmr.user_id = ?
					)
			`, [userId, userId, userId, userId]);

			return result?.count || 0;
		} catch (e) {
			console.error('[DB] getTotalUnreadChatCount error:', e);
			return 0;
		}
	}

	/* Récupère les compteurs de messages non lus groupés par utilisateur (pour les notifications WebSocket) */
	async getUnreadMessageCounts(userId: number): Promise<Array<{ userId: number; username: string; count: number; lastMessageTime: string }>> {
		try {
			// Filtrer uniquement par blocked_users, pas par sent_while_blocked
			const query = `
				SELECT 
					sender.id as userId, 
					sender.username, 
					COUNT(*) as count, 
					MAX(m.created_at) as lastMessageTime
				FROM messages m
				JOIN users sender ON m.sender_id = sender.id
				JOIN conversation_participants cp1 ON m.conversation_id = cp1.conversation_id
				WHERE cp1.user_id = ? 
					AND m.sender_id != ? 
					AND m.conversation_id != 1
					AND NOT EXISTS (
						SELECT 1 FROM blocked_users bu 
						WHERE bu.blocker_id = ? AND bu.blocked_id = m.sender_id
					)
					AND NOT EXISTS (
						SELECT 1 FROM chat_message_reads cmr 
						WHERE cmr.message_id = m.id AND cmr.user_id = ?
					)
				GROUP BY sender.id, sender.username
				ORDER BY lastMessageTime DESC
			`;

			const results = await this.dbAll(query, [userId, userId, userId, userId]);
			
			console.log('[DB] Unread message counts retrieved:', {
				userId,
				countByUser: results.length,
				totalUnread: results.reduce((sum, r) => sum + r.count, 0)
			});
			
			return results;
		} catch (e) {
			console.error('[DB] getUnreadMessageCounts error:', e);
			return [];
		}
	}

	async isMessageRead(messageId: number, userId: number): Promise<boolean> {
		try {
			const result = await this.dbGet('SELECT 1 FROM chat_message_reads WHERE message_id = ? AND user_id = ?', [messageId, userId]);
			return !!result;
		} catch (e) {
			console.error('[DB] isMessageRead error:', e);
			return false;
		}
	}

	async cleanupOldMessageReads(daysOld: number = 30): Promise<void> {
		try {
			await this.dbRun(`DELETE FROM chat_message_reads WHERE read_at < datetime('now', '-${daysOld} days')`);
		} catch (e) {
			console.error('[DB] cleanupOldMessageReads error:', e);
		}
	}
}