// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2

// ============================================================================
// Helper Functions - Data Extraction
// ============================================================================

/**
 * Extract ID da Inscrição from text (if present)
 * @param {string} text - Text to search for ID
 * @returns {string|null} - ID if found, null otherwise
 */
const extractInscriptionId = (text) => {
  if (!text) return null;
  // Match ID in parentheses: can contain uppercase, lowercase letters and numbers
  // Example: "Inscrição de Luiz para Evento (81VYLQl)."
  const match = text.match(/\(([A-Za-z0-9]+)\)/);
  return match ? match[1] : null;
};

/**
 * Extract payment data from Asaas webhook payload
 * @param {object} webhookData - Raw webhook payload
 * @returns {object} - Extracted payment data
 */
const extractPaymentData = (webhookData) => {
  const payment = webhookData.payment || webhookData;
  
  return {
    eventType: webhookData.event || webhookData.action || '',
    paymentStatus: payment.status || webhookData.status || '',
    amount: payment.value || webhookData.value || null,
    description: payment.description || webhookData.description || '',
    name: payment.name || webhookData.name || '',
    paymentId: payment.id || webhookData.id || null,
    customerName: payment.customerName || webhookData.customerName || null,
    customerEmail: payment.customerEmail || webhookData.customerEmail || null,
    billingType: payment.billingType || webhookData.billingType || null,
    dueDate: payment.dueDate || webhookData.dueDate || null
  };
};

/**
 * Check if payment is confirmed/received
 * @param {string} eventType - Event type from webhook
 * @param {string} paymentStatus - Payment status
 * @returns {boolean}
 */
const isPaymentConfirmed = (eventType, paymentStatus) => {
  return (
    eventType === 'PAYMENT_CONFIRMED' ||
    eventType === 'PAYMENT_RECEIVED' ||
    paymentStatus === 'CONFIRMED' ||
    paymentStatus === 'RECEIVED' ||
    paymentStatus === 'RECEIVED_IN_CASH_OFFLINE'
  );
};

// ============================================================================
// Helper Functions - Slack Logging
// ============================================================================

/**
 * Send payment log to Slack
 * @param {string} webhookUrl - Slack webhook URL
 * @param {object} paymentData - Payment data to log
 * @param {object} eventData - Optional event-specific data
 */
const sendSlackLog = async (webhookUrl, paymentData, eventData = {}) => {
  if (!webhookUrl) return;

  try {
    const fields = [
      {
        type: "mrkdwn",
        text: `*Evento Asaas:*\n${paymentData.eventType || 'N/A'}`
      },
      {
        type: "mrkdwn",
        text: `*Status:*\n${paymentData.paymentStatus || 'N/A'}`
      },
      {
        type: "mrkdwn",
        text: `*Valor:*\n${paymentData.amount ? `R$ ${paymentData.amount.toFixed(2)}` : 'N/A'}`
      },
      {
        type: "mrkdwn",
        text: `*Tipo:*\n${paymentData.billingType || 'N/A'}`
      }
    ];

    // Add event-specific fields if present
    if (eventData.inscriptionId) {
      fields.unshift({
        type: "mrkdwn",
        text: `*ID da Inscrição:*\n${eventData.inscriptionId}`
      });
    }

    if (eventData.userName) {
      fields.push({
        type: "mrkdwn",
        text: `*Nome:*\n${eventData.userName}`
      });
    }

    if (eventData.userEmail) {
      fields.push({
        type: "mrkdwn",
        text: `*Email:*\n${eventData.userEmail}`
      });
    }

    if (eventData.statusUpdated !== undefined) {
      fields.push({
        type: "mrkdwn",
        text: `*Status Atualizado:*\n${eventData.statusUpdated ? '✅ Sim' : '❌ Não'}`
      });
    }

    if (eventData.emailSent !== undefined) {
      fields.push({
        type: "mrkdwn",
        text: `*Email Enviado:*\n${eventData.emailSent ? '✅ Sim' : '❌ Não'}`
      });
    }

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: eventData.inscriptionId ? "💰 Pagamento de Evento Processado" : "💰 Pagamento Processado",
          emoji: true
        }
      },
      {
        type: "section",
        fields: fields
      }
    ];

    // Add error message if present
    if (eventData.error) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⚠️ Erro:*\n\`\`\`${eventData.error}\`\`\``
        }
      });
    }

    // Add description if available and no event data
    if (!eventData.inscriptionId && paymentData.description) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Descrição:*\n${paymentData.description.substring(0, 200)}${paymentData.description.length > 200 ? '...' : ''}`
        }
      });
    }

    // Add timestamp
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🕐 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        }
      ]
    });

    const slackMessage = {
      text: eventData.inscriptionId ? "💰 Pagamento de Evento Processado" : "💰 Pagamento Processado",
      blocks: blocks
    };

    const slackOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
      redirect: 'follow'
    };

    await fetch(webhookUrl, slackOptions);
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
  }
};

// ============================================================================
// Helper Functions - Airtable
// ============================================================================

/**
 * Find record in Airtable by ID da Inscrição
 * @param {string} baseId - Airtable base ID
 * @param {string} tableName - Table name
 * @param {string} searchField - Field to search
 * @param {string} id - ID to search for
 * @param {string} apiKey - Airtable API key
 * @returns {object|null} - Record if found, null otherwise
 */
const findRecordFull = async (baseId, tableName, searchField, id, apiKey) => {
  const filterFormula = encodeURIComponent(`{${searchField}} = "${id}"`);
  const findUrl = `https://api.airtable.com/v0/${baseId}/${tableName}?filterByFormula=${filterFormula}`;

  const findHeaders = new Headers();
  findHeaders.append("Authorization", `Bearer ${apiKey}`);

  const findOptions = {
    method: 'GET',
    headers: findHeaders,
    redirect: 'follow'
  };

  const findResponse = await fetch(findUrl, findOptions);
  const findResult = await findResponse.json();

  if (!findResult.records || findResult.records.length === 0) {
    return null;
  }

  return findResult.records[0];
};

/**
 * Update record in Airtable
 * @param {string} baseId - Airtable base ID
 * @param {string} tableName - Table name
 * @param {string} recordId - Record ID
 * @param {object} fields - Fields to update
 * @param {string} apiKey - Airtable API key
 * @returns {object} - Updated record
 */
const updateRecord = async (baseId, tableName, recordId, fields, apiKey) => {
  const updateUrl = `https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`;

  const updateHeaders = new Headers();
  updateHeaders.append("Authorization", `Bearer ${apiKey}`);
  updateHeaders.append("Content-Type", "application/json");

  const updateBody = JSON.stringify({ fields });

  const updateOptions = {
    method: 'PATCH',
    headers: updateHeaders,
    body: updateBody,
    redirect: 'follow'
  };

  const updateResponse = await fetch(updateUrl, updateOptions);
  const updateResult = await updateResponse.json();

  if (!updateResponse.ok) {
    throw new Error(`Failed to update record: ${JSON.stringify(updateResult)}`);
  }

  return updateResult;
};

// ============================================================================
// Helper Functions - Email
// ============================================================================

/**
 * Send payment confirmation email via Resend
 * @param {string} apiKey - Resend API key
 * @param {string} userEmail - Recipient email
 * @param {string} userName - User name
 * @param {string} eventName - Event name
 * @returns {object} - Resend response
 */
const sendPaymentConfirmationEmail = async (apiKey, userEmail, userName, eventName) => {
  const emailSubject = `Pagamento Confirmado - ${eventName}`;
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Pagamento Confirmado!</h2>
        <p>Olá <strong>${userName}</strong>,</p>
        <p>Seu pagamento para o evento <strong>${eventName}</strong> foi confirmado com sucesso!</p>
        <p>Sua inscrição está completa e confirmada.</p>
     </div>
    </body>
    </html>
  `;

  const resendHeaders = new Headers();
  resendHeaders.append("Authorization", `Bearer ${apiKey}`);
  resendHeaders.append("Content-Type", "application/json");

  const resendBody = JSON.stringify({
    from: "luiz@metodistarenovada.com",
    to: userEmail,
    subject: emailSubject,
    html: emailHtml
  });

  const resendOptions = {
    method: 'POST',
    headers: resendHeaders,
    body: resendBody,
    redirect: 'follow'
  };

  const resendResponse = await fetch("https://api.resend.com/emails", resendOptions);
  const resendResult = await resendResponse.json();

  if (!resendResponse.ok) {
    throw new Error(`Resend API error: ${JSON.stringify(resendResult)}`);
  }

  return resendResult;
};

// ============================================================================
// Event Processing Functions
// ============================================================================

/**
 * Process event registration payment
 * @param {object} params - Processing parameters
 * @returns {object} - Processing result
 */
const processEventPayment = async ({
  inscriptionId,
  paymentData,
  airtableConfig,
  resendApiKey,
  airtableApiKey
}) => {
  const {
    BASE_ID,
    TABLE_NAME,
    SEARCH_FIELD,
    STATUS_FIELD,
    EMAIL_FIELD,
    TAGS_FIELD,
    STATUS_VALUE,
    TAG_EMAIL_PAGAMENTO
  } = airtableConfig;

  // Find record in Airtable
  const record = await findRecordFull(BASE_ID, TABLE_NAME, SEARCH_FIELD, inscriptionId, airtableApiKey);

  if (!record) {
    return {
      success: false,
      error: `Record with Id da Inscrição "${inscriptionId}" not found`,
      statusUpdated: false,
      emailSent: false
    };
  }

  // Check if email-pagamento tag already exists
  const currentTags = record.fields[TAGS_FIELD] || [];
  const hasEmailTag = Array.isArray(currentTags) && currentTags.includes(TAG_EMAIL_PAGAMENTO);

  // Prepare fields to update
  const fieldsToUpdate = {
    [STATUS_FIELD]: STATUS_VALUE
  };

  let emailSent = false;
  let error = null;

  // Send email if tag doesn't exist
  if (!hasEmailTag) {
    const userEmail = record.fields[EMAIL_FIELD];

    if (!userEmail) {
      // Update status even if email is missing
      await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, airtableApiKey);
      
      return {
        success: false,
        error: 'User email not found in Airtable record',
        statusUpdated: true,
        emailSent: false,
        userName: record.fields['Nome'] || record.fields['name'] || 'Usuário'
      };
    }

    const userName = record.fields['Nome'] || record.fields['name'] || 'Usuário';
    
    // Extract event name from description or name
    const eventNameMatch = paymentData.description.match(/para\s+([^(]+)\s+da/) || 
                          paymentData.name.match(/Inscrição\s+([^:]+):/);
    const eventName = eventNameMatch ? eventNameMatch[1].trim() : 'Evento';

    try {
      await sendPaymentConfirmationEmail(resendApiKey, userEmail, userName, eventName);
      emailSent = true;

      // Add email-pagamento tag to prevent duplicates
      const updatedTags = Array.isArray(currentTags) 
        ? [...currentTags, TAG_EMAIL_PAGAMENTO]
        : [TAG_EMAIL_PAGAMENTO];

      fieldsToUpdate[TAGS_FIELD] = updatedTags;
    } catch (emailError) {
      error = emailError.message;
      // Continue to update status even if email fails
    }
  }

  // Update record in Airtable
  await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, airtableApiKey);

  return {
    success: true,
    error: error,
    statusUpdated: true,
    emailSent: emailSent,
    userName: record.fields['Nome'] || record.fields['name'] || 'Usuário',
    userEmail: record.fields[EMAIL_FIELD] || null
  };
};

// ============================================================================
// Main Handler
// ============================================================================

const handler = async (event) => {
  try {
    // Verify it's a POST request
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ message: 'Method not allowed. Use POST.' })
      };
    }

    // Parse webhook payload
    let webhookData;
    try {
      webhookData = JSON.parse(event.body);
    } catch (parseError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid JSON payload', error: parseError.toString() })
      };
    }

    // Get environment variables
    const { RESEND_API_KEY, AIRTABLE_API_KEY, SLACK_WEBHOOK_URL } = process.env;

    // Airtable configuration
    const airtableConfig = {
      BASE_ID: 'app1w80Zv4Vo2FUdN',
      TABLE_NAME: 'Inscritos',
      SEARCH_FIELD: 'Id da Inscrição',
      STATUS_FIELD: 'Status',
      EMAIL_FIELD: 'Email',
      TAGS_FIELD: 'Tags',
      STATUS_VALUE: 'Pago',
      TAG_EMAIL_PAGAMENTO: 'email-pagamento'
    };

    // Extract payment data from webhook
    const paymentData = extractPaymentData(webhookData);

    // Check if payment is confirmed
    if (!isPaymentConfirmed(paymentData.eventType, paymentData.paymentStatus)) {
      // Log to Slack (payment not confirmed yet)
      if (SLACK_WEBHOOK_URL) {
        await sendSlackLog(SLACK_WEBHOOK_URL, paymentData, {
          error: 'Payment not confirmed yet, skipping'
        });
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Payment not confirmed yet, skipping',
          eventType: paymentData.eventType,
          paymentStatus: paymentData.paymentStatus
        })
      };
    }

    // Try to extract ID da Inscrição
    let inscriptionId = extractInscriptionId(paymentData.description);
    if (!inscriptionId) {
      inscriptionId = extractInscriptionId(paymentData.name);
    }

    // If inscription ID found, process as event payment
    if (inscriptionId) {
      // Check if API keys are configured
      if (!AIRTABLE_API_KEY || !RESEND_API_KEY) {
        // Log to Slack if configured
        if (SLACK_WEBHOOK_URL) {
          await sendSlackLog(SLACK_WEBHOOK_URL, paymentData, {
            inscriptionId,
            error: 'AIRTABLE_API_KEY or RESEND_API_KEY not configured'
          });
        }

        return {
          statusCode: 500,
          body: JSON.stringify({ message: 'API keys not configured' })
        };
      }

      // Process event payment
      const eventResult = await processEventPayment({
        inscriptionId,
        paymentData,
        airtableConfig,
        resendApiKey: RESEND_API_KEY,
        airtableApiKey: AIRTABLE_API_KEY
      });

      // Log result to Slack if configured
      if (SLACK_WEBHOOK_URL) {
        await sendSlackLog(SLACK_WEBHOOK_URL, paymentData, {
          inscriptionId,
          userName: eventResult.userName,
          userEmail: eventResult.userEmail,
          statusUpdated: eventResult.statusUpdated,
          emailSent: eventResult.emailSent,
          error: eventResult.error
        });
      }

      return {
        statusCode: eventResult.success ? 200 : 400,
        body: JSON.stringify({
          message: eventResult.success 
            ? 'Payment confirmed and processed successfully' 
            : eventResult.error,
          inscriptionId,
          statusUpdated: eventResult.statusUpdated,
          emailSent: eventResult.emailSent
        })
      };
    }

    // No inscription ID found - this is a regular payment (not an event)
    // Log to Slack if configured
    if (SLACK_WEBHOOK_URL) {
      await sendSlackLog(SLACK_WEBHOOK_URL, paymentData, {
        inscriptionId: null
      });
    }

    // Return success for regular payments
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Payment logged successfully',
        isEventPayment: false
      })
    };

  } catch (error) {
    // Log error to Slack if configured
    const { SLACK_WEBHOOK_URL } = process.env;
    if (SLACK_WEBHOOK_URL) {
      try {
        await sendSlackLog(SLACK_WEBHOOK_URL, {}, {
          error: `Internal server error: ${error.toString()}`
        });
      } catch (slackError) {
        console.error('Failed to send error to Slack:', slackError);
      }
    }

    return { 
      statusCode: 500, 
      body: JSON.stringify({ message: 'Internal server error', error: error.toString() })
    };
  }
};

module.exports = { handler };
