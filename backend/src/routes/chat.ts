// backend/src/routes/chat.ts

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dbService } from '../services/database';

interface SendMessageBody { recipientId?: number; content: string; messageType?: string; metadata?: string; conversationId?: number }
interface BlockUserBody { userId: number }
interface GameChallengeBody { challengedUserId: number; message?: string; gameMode?: string }
interface FriendRequestBody { userId: number; message?: string }
type FriendlyChallengeGuard = (challengerId: number, challengedUserId: number) => Promise<{ ok: boolean; error?: string }>;

/* Limite de longueur des messages de chat (privé + global) */
const MAX_CHAT_CHARS = 500;

/* Enregistre les routes de chat et initialise les dépendances */
export default async function chatRoutes(fastify: FastifyInstance) {
  console.log('💬 Loading chat routes...');

  // Helpers compacts pour réduire les répétitions 
  const ok = (reply: FastifyReply, payload: any) => reply.send(payload);
  const bad = (reply: FastifyReply, code: number, message: string) => reply.code(code).send({ success:false, message });
  const err500 = (reply: FastifyReply, e: any, tag: string) => { console.error(tag, e); reply.code(500).send({ success:false, message:'Internal server error' }) };
  const auth = { preValidation: [ (fastify as any).authenticate ] };
  const idParam = (v: any, name: string, reply: FastifyReply) => { const n = parseInt(v); if (isNaN(n)) { bad(reply,400,`Invalid ${name}`); return null } return n };

  /* Fonction de broadcast WebSocket améliorée */
  const broadcastToUser = (userId: number, type: string, data: any) => {
    try {
      const broadcaster = (fastify as any).broadcastToUser;
      if (typeof broadcaster === 'function') {
        broadcaster(userId, type, data);
      } else {
        console.warn('[CHAT] Broadcaster WebSocket non disponible');
      }
    } catch (e) {
      console.warn('[CHAT] Broadcast WebSocket échoué:', e);
    }
  };

  const friendlyChallengeGuard = (fastify as any).ensureFriendlyChallengePossible as FriendlyChallengeGuard | undefined;

  /* CHAT GLOBAL CHAT */

  /* Récupérer les messages du chat global */
  fastify.get('/global', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const limit = request.query.limit ? parseInt(request.query.limit) : 50;
      const offset = request.query.offset ? parseInt(request.query.offset) : 0;
      
      // Chat global = conversation ID 1
      const messages = await dbService.getMessages(1, userId, limit, offset);
      return ok(reply, { success: true, messages, conversationType: 'global' });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors de la récupération du chat global:');
    }
  });

  /*  Envoyer un message dans le chat global avec vérification de blocage */
  fastify.post('/global', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { content, messageType = 'text', metadata }: { content: string; messageType?: string; metadata?: string } = request.body;

      // Validations (trim pour cohérence avec DB/service)
      const trimmed = (content ?? '').trim();
      if (trimmed.length === 0) return bad(reply, 400, 'Message content cannot be empty');
      if (trimmed.length > MAX_CHAT_CHARS) return bad(reply, 400, `Global chat message too long (max ${MAX_CHAT_CHARS} characters)`);

      // Anti-spam (max 1 message par seconde)
      const lastMessage = await dbService.getLastUserMessage(userId, 1);
      if (lastMessage && (Date.now() - new Date(lastMessage.created_at).getTime()) < 1000) {
        return bad(reply, 429, 'Please wait before sending another message');
      }

      // Vérifier si l'expéditeur est bloqué par n'importe quel utilisateur
      const onlineUsers = await dbService.getOnlineUsers();
      let sentWhileBlocked = false;
      
      for (const user of onlineUsers) {
        if (user.id !== userId) {
          const isBlocked = await dbService.isUserBlocked(user.id, userId);
          if (isBlocked) {
            sentWhileBlocked = true;
            break;
          }
        }
      }

      // Envoyer le message avec le flag sent_while_blocked
      const messageId = await dbService.sendMessage(
        1, 
        userId, 
        trimmed, 
        messageType, 
        metadata,
        sentWhileBlocked // Nouveau paramètre
      );

      // Récupérer les infos de l'expéditeur
      const sender = await dbService.getUserById(userId);
      
      // Broadcast temps-réel à tous les utilisateurs connectés (sauf bloqués)
      const messageData = {
        id: messageId,
        conversation_id: 1,
        sender_id: userId,
        sender_username: sender?.username || `User${userId}`,
        content: trimmed,
        message_type: messageType,
        ...(metadata ? { metadata } : {}),
        created_at: new Date().toISOString(),
        conversationType: 'global'
      };

      // Broadcaster uniquement aux utilisateurs qui n'ont PAS bloqué l'expéditeur
      for (const user of onlineUsers) {
        if (user.id !== userId) {
          const isBlocked = await dbService.isUserBlocked(user.id, userId);
          if (!isBlocked) {
            broadcastToUser(user.id, 'chat:global_message', messageData);
          }
        }
      }

      console.log('[CHAT] ✅ Global message sent:', {
        from: sender?.username,
        content: trimmed.substring(0, 50),
        sentWhileBlocked // Log du statut
      });

      return ok(reply, { 
        success: true, 
        message: 'Global message sent successfully', 
        messageId 
      });
    } catch (e: any) {
      return err500(reply, e, "Erreur lors de l'envoi du message global:");
    }
  });

  /* CHAT PRIVÉ */

  /* Récupérer les conversations privées de l'utilisateur */
  fastify.get('/conversations', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const conversations = await dbService.getUserConversations(userId);
      return ok(reply,{ success:true, conversations });
    } catch (e:any) { return err500(reply, e, 'Erreur lors de la récupération des conversations:') }
  });

  /* Récupérer les messages d'une conversation privée */
  fastify.get('/conversations/:conversationId/messages', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const conversationId = idParam(request.params.conversationId,'conversation ID',reply); if (conversationId===null) return;
      
      // Empêcher l'accès au chat global via cette route
      if (conversationId === 1) return bad(reply, 403, 'Use /global endpoint for global chat');
      
      const limit = request.query.limit ? parseInt(request.query.limit) : 50;
      const offset = request.query.offset ? parseInt(request.query.offset) : 0;
      const messages = await dbService.getMessages(conversationId, userId, limit, offset);
      return ok(reply,{ success:true, messages, conversationType: 'private' });
    } catch (e:any) {
      console.error('Erreur lors de la récupération des messages:', e);
      if (e.message === 'Access denied to this conversation') return bad(reply,403,e.message);
      return bad(reply,500,'Internal server error');
    }
  });

  /* Obtenir la conversation privée entre deux utilisateurs */
  fastify.get('/conversation/:userId', auth, async (request: any, reply: FastifyReply) => {
    try {
      const currentUserId = request.user.id;
      const otherUserId = idParam(request.params.userId,'user ID',reply); if (otherUserId===null) return;
      
      // Vérifier que l'utilisateur n'est pas bloqué
      const isBlocked = await dbService.isUserBlocked(currentUserId, otherUserId);
      if (isBlocked) return bad(reply, 403, 'Cannot access conversation with this user');
      
      const conversationId = await dbService.getOrCreatePrivateConversation(currentUserId, otherUserId);
      const messages = await dbService.getMessages(conversationId, currentUserId, 50, 0);
      return ok(reply,{ success:true, conversationId, messages, conversationType: 'private' });
    } catch (e:any) { return err500(reply, e, 'Erreur lors de la récupération de la conversation:') }
  });

  /* Envoyer un message privé avec vérification de blocage */
  fastify.post('/messages', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { recipientId, content, messageType = 'text', metadata }: SendMessageBody = request.body;

      // Validations (trim pour cohérence avec DB/service)
      if (!recipientId) return bad(reply, 400, 'Recipient ID and content are required');
      const trimmed = (content ?? '').trim();
      if (trimmed.length === 0) return bad(reply, 400, 'Message content cannot be empty');
      if (trimmed.length > MAX_CHAT_CHARS) return bad(reply, 400, `Message too long (max ${MAX_CHAT_CHARS} characters)`);

      // Vérifier que le destinataire existe
      const recipient = await dbService.getUserById(recipientId);
      if (!recipient) return bad(reply, 404, 'Recipient not found');

      // Vérifier si l'expéditeur est bloqué par le destinataire
      const isBlockedBySender = await dbService.isUserBlocked(userId, recipientId);
      const isBlockedByRecipient = await dbService.isUserBlocked(recipientId, userId);
      
      // L'expéditeur ne peut pas envoyer s'il a bloqué le destinataire
      if (isBlockedBySender) {
        return bad(reply, 403, 'Cannot send message to this user');
      }

      // Créer ou récupérer la conversation
      const conversationId = await dbService.getOrCreatePrivateConversation(userId, recipientId);

      // Envoyer le message avec le flag si bloqué par le destinataire
      const messageId = await dbService.sendMessage(
        conversationId, 
        userId, 
        trimmed, 
        messageType, 
        metadata,
        isBlockedByRecipient // Marquer si le destinataire a bloqué l'expéditeur
      );

      // Récupérer les infos de l'expéditeur
      const sender = await dbService.getUserById(userId);
      
      // Push temps-réel via WebSocket
      const messageData = {
        id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        sender_username: sender?.username || `User${userId}`,
        recipient_id: recipientId,
        content: trimmed,
        message_type: messageType,
        ...(metadata ? { metadata } : {}),
        created_at: new Date().toISOString(),
        conversationType: 'private'
      };

      // Envoyer à l'expéditeur
      broadcastToUser(userId, 'chat:private_message', messageData);
      
      // Envoyer au destinataire SEULEMENT s'il n'a pas bloqué l'expéditeur
      if (!isBlockedByRecipient) {
        broadcastToUser(recipientId, 'chat:private_message', messageData);
        
        // Créer une notification seulement si non bloqué
        await dbService.createNotification(
          recipientId,
          'message',
          'New message',
          `${sender?.username} sent you a message`,
          JSON.stringify({ senderId: userId, conversationId, messageId })
        );
      }

      console.log('[CHAT] ✅ Private message sent:', {
        from: sender?.username,
        to: recipient.username,
        messageId,
        conversationId,
        sentWhileBlocked: isBlockedByRecipient // Log du statut
      });

      return ok(reply, { 
        success: true, 
        message: 'Message sent successfully', 
        messageId, 
        conversationId 
      });
    } catch (e: any) {
      return err500(reply, e, "Erreur lors de l'envoi du message:")
    }
  });

  /* Obtenir les compteurs de messages non lus */
  fastify.get('/unread-counts', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const unreadCounts = await dbService.getUnreadChatCounts(userId);
      const totalUnreadCount = await dbService.getTotalUnreadChatCount(userId);
      return ok(reply, { success: true, unreadCounts, totalUnreadCount });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors de la récupération des messages non lus:');
    }
  });

  /* Marquer les messages d'un utilisateur comme lus */
  fastify.post('/mark-read', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { otherUserId }: { otherUserId: number } = request.body;

      if (!otherUserId) return bad(reply, 400, 'Other user ID is required');

      await dbService.markUserMessagesAsRead(userId, otherUserId);

      const totalUnreadCount = await dbService.getTotalUnreadChatCount(userId);
      const unreadCounts = await dbService.getUnreadChatCounts(userId);
      
      broadcastToUser(userId, 'chat:unread_update', {
        totalUnreadCount,
        unreadCounts
      });

      return ok(reply, {
        success: true,
        message: 'Messages marked as read',
        totalUnreadCount
      });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors du marquage des messages comme lus:');
    }
  });

  /* Marquer tous les messages d'une conversation comme lus */
  fastify.post('/mark-conversation-read', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { conversationId }: { conversationId: number } = request.body;

      if (!conversationId) return bad(reply, 400, 'Conversation ID is required');

      await dbService.markConversationMessagesAsRead(conversationId, userId);

      const totalUnreadCount = await dbService.getTotalUnreadChatCount(userId);
      const unreadCounts = await dbService.getUnreadChatCounts(userId);
      
      broadcastToUser(userId, 'chat:unread_update', {
        totalUnreadCount,
        unreadCounts
      });

      return ok(reply, {
        success: true,
        message: 'Conversation marked as read',
        totalUnreadCount
      });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors du marquage de la conversation comme lue:');
    }
  });

  /* GESTION DES PROFILS */

  /* Bloquer un utilisateur */
  fastify.post('/block', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { userId: blockedUserId, reason }: BlockUserBody & { reason?: string } = request.body;
      if (!blockedUserId) return bad(reply,400,'User ID is required');
      await dbService.blockUser(userId, blockedUserId, reason);
      return ok(reply,{ success:true, message:'User blocked successfully' });
    } catch (e:any) {
      console.error('Erreur lors du blocage:', e);
      if (e.message === 'Cannot block yourself') return bad(reply,400,e.message);
      return bad(reply,500,'Internal server error');
    }
  });

  /* Débloquer un utilisateur */
  fastify.delete('/block/:userId', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const blockedUserId = idParam(request.params.userId,'user ID',reply); if (blockedUserId===null) return;
      await dbService.unblockUser(userId, blockedUserId);
      return ok(reply,{ success:true, message:'User unblocked successfully' });
    } catch (e:any) {
      console.error('Erreur lors du déblocage:', e);
      if (e.message === 'User was not blocked') return bad(reply,404,e.message);
      return bad(reply,500,'Internal server error');
    }
  });

  /* Récupérer la liste des utilisateurs bloqués */
  fastify.get('/blocked', auth, async (request: any, reply: FastifyReply) => {
    try {
      const blockedUsers = await dbService.getBlockedUsers(request.user.id);
      return ok(reply,{ success:true, blocked_users: blockedUsers });
    } catch (e:any) {
      return err500(reply, e, 'Erreur lors de la récupération des utilisateurs bloqués:')
    }
  });

  /* Envoyer une demande d'ami */
  fastify.post('/friend-request', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { userId: requestedUserId, message }: FriendRequestBody = request.body;
      
      if (!requestedUserId) return bad(reply, 400, 'User ID is required');
      if (requestedUserId === userId) return bad(reply, 400, 'Cannot send friend request to yourself');
      
      // Vérifier que l'utilisateur existe
      const requestedUser = await dbService.getUserById(requestedUserId);
      if (!requestedUser) return bad(reply, 404, 'User not found');
      
      // Vérifier que l'utilisateur n'est pas bloqué
      const isBlocked = await dbService.isUserBlocked(userId, requestedUserId) || await dbService.isUserBlocked(requestedUserId, userId);
      
      // Créer la demande d'ami
      const requestId = await dbService.createFriendRequest(userId, requestedUserId, message);
      
      // Notifier le destinataire
      const requester = await dbService.getUserById(userId);
      await dbService.createNotification(
        requestedUserId,
        'friend_request',
        'New friend request',
        `${requester?.username} sent you a friend request`,
        JSON.stringify({ requesterId: userId, requestId, message })
      );
      
      // Broadcast WebSocket
      broadcastToUser(requestedUserId, 'friend:request_received', {
        requestId,
        requester: { id: userId, username: requester?.username },
        message
      });
      
      return ok(reply, { 
        success: true, 
        message: 'Friend request sent successfully',
        requestId 
      });
    } catch (e: any) {
      console.error('Erreur lors de l\'envoi de la demande d\'ami:', e);
      if (e.message.includes('already')) return bad(reply, 409, e.message);
      return err500(reply, e, 'Erreur lors de l\'envoi de la demande d\'ami:');
    }
  });

  /* Envoyer un défi de jeu */
  fastify.post('/game-challenge', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { challengedUserId, message, gameMode = 'classic' }: GameChallengeBody = request.body;
      
      if (!challengedUserId) return bad(reply, 400, 'Challenged user ID is required');
      if (challengedUserId === userId) return bad(reply, 400, 'Cannot challenge yourself');

      if (friendlyChallengeGuard) {
        const guardResult = await friendlyChallengeGuard(userId, challengedUserId);
        if (!guardResult.ok) {
          return bad(reply, 409, guardResult.error || 'Cannot challenge this user right now');
        }
      }
      
      // Vérifier que l'utilisateur existe et est en ligne
      const challengedUser = await dbService.getUserById(challengedUserId);
      if (!challengedUser) return bad(reply, 404, 'User not found');
      if (!challengedUser.is_online) return bad(reply, 400, 'User is not online');
      
      // Vérifier que l'utilisateur n'est pas bloqué
      const isBlocked = await dbService.isUserBlocked(userId, challengedUserId) || await dbService.isUserBlocked(challengedUserId, userId);
      if (isBlocked) return bad(reply, 403, 'Cannot challenge this user');
      
      // Créer le défi
      const challengeId = await dbService.createGameChallenge(userId, challengedUserId, message, gameMode);
      
      // Notifier le destinataire
      const challenger = await dbService.getUserById(userId);
      await dbService.createNotification(
        challengedUserId,
        'game_challenge',
        'Game challenge',
        `${challenger?.username} challenged you to a ${gameMode} game`,
        JSON.stringify({ challengerId: userId, challengeId, gameMode, message })
      );
      
      // Broadcast WebSocket
      broadcastToUser(challengedUserId, 'game:challenge_received', {
        challengeId,
        challenger: { id: userId, username: challenger?.username },
        gameMode,
        message
      });
      
      return ok(reply, { 
        success: true, 
        message: 'Game challenge sent successfully',
        challengeId 
      });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors de l\'envoi du défi:');
    }
  });

  /*  Envoyer une invitation de jeu via chat avec vérification de blocage */
  fastify.post('/game-invite', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const { recipientId }: { recipientId: number } = request.body;
      
      if (!recipientId) return bad(reply, 400, 'Recipient ID is required');

      // Vérifier que le destinataire existe
      const recipient = await dbService.getUserById(recipientId);
      if (!recipient) return bad(reply, 404, 'User not found');

      // Vérifier que l'utilisateur n'est pas bloqué
      const isBlockedBySender = await dbService.isUserBlocked(userId, recipientId);
      const isBlockedByRecipient = await dbService.isUserBlocked(recipientId, userId);
      
      if (isBlockedBySender) return bad(reply, 403, 'Cannot send invitation to this user');

      if (friendlyChallengeGuard) {
        const guardResult = await friendlyChallengeGuard(userId, recipientId);
        if (!guardResult.ok) {
          return bad(reply, 409, guardResult.error || 'Cannot invite this user right now');
        }
      } else {
        console.warn('[CHAT] Friendly challenge guard not available - skipping availability checks for /game-invite');
      }

      const user = await dbService.getUserById(userId);
      const inviteMessage = `${user?.username} invited you to play Pong!`;
      const metadata = JSON.stringify({ 
        type: 'game_invite', 
        inviterId: userId, 
        inviterName: user?.username 
      });

      // Créer ou récupérer la conversation
      const conversationId = await dbService.getOrCreatePrivateConversation(userId, recipientId);

      // Envoyer l'invitation avec le flag si bloqué
      const messageId = await dbService.sendMessage(
        conversationId, 
        userId, 
        inviteMessage, 
        'game_invite', 
        metadata,
        isBlockedByRecipient // Marquer si bloqué
      );

      // Push temps-réel pour l'invitation
      const inviteData = {
        id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        sender_username: user?.username || `User${userId}`,
        content: inviteMessage,
        message_type: 'game_invite',
        metadata,
        created_at: new Date().toISOString(),
        conversationType: 'private'
      };

      // Envoyer à l'expéditeur
      broadcastToUser(userId, 'chat:game_invitation', inviteData);
      
      // Envoyer au destinataire seulement si non bloqué
      if (!isBlockedByRecipient) {
        broadcastToUser(recipientId, 'chat:game_invitation', inviteData);
      }

      return ok(reply, { 
        success: true, 
        message: 'Game invitation sent successfully', 
        messageId, 
        conversationId 
      });
    } catch (e: any) {
      return err500(reply, e, "Erreur lors de l'envoi de l'invitation:")
    }
  });

  /* NOTIFICATIONS */

  /* Récupérer les notifications de l'utilisateur */
  fastify.get('/notifications', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const limit = request.query.limit ? parseInt(request.query.limit) : 20;
      const unreadOnly = request.query.unread === 'true';
      
      const notifications = await dbService.getUserNotifications(userId, limit, unreadOnly);
      const unreadCount = await dbService.getUnreadNotificationCount(userId);
      
      return ok(reply, { 
        success: true, 
        notifications, 
        unreadCount 
      });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors de la récupération des notifications:');
    }
  });

  /* Marquer une notification comme lue */
  fastify.put('/notifications/:id/read', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      const notificationId = idParam(request.params.id, 'notification ID', reply);
      if (notificationId === null) return;
      
      await dbService.markNotificationAsRead(notificationId, userId);
      return ok(reply, { success: true, message: 'Notification marked as read' });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors du marquage de la notification:');
    }
  });

  /* Marquer toutes les notifications comme lues */
  fastify.put('/notifications/read-all', auth, async (request: any, reply: FastifyReply) => {
    try {
      const userId = request.user.id;
      await dbService.markAllNotificationsAsRead(userId);
      return ok(reply, { success: true, message: 'All notifications marked as read' });
    } catch (e: any) {
      return err500(reply, e, 'Erreur lors du marquage des notifications:');
    }
  });

  console.log('✅ Chat routes registered: /global, /conversations, /messages, /block, /friend-request, /game-challenge, /notifications, /unread-counts, /mark-read, /mark-conversation-read');
}
