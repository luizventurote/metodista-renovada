// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2

// Helper function to extract ID da Inscrição from text
const extractInscriptionId = (text) => {
  if (!text) return null;
  
  // Try to find ID in parentheses: "Inscrição de [nome] para [evento] da Igreja Metodista Renovada ([id])."
  // or "Inscrição [evento]: [nome] ([id])"
  const match = text.match(/\(([A-Z0-9]+)\)/);
  return match ? match[1] : null;
};

// Helper function to find record in Airtable and return full record
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

// Helper function to update record in Airtable
const updateRecord = async (baseId, tableName, recordId, fields, apiKey) => {
  const updateUrl = `https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`;

  const updateHeaders = new Headers();
  updateHeaders.append("Authorization", `Bearer ${apiKey}`);
  updateHeaders.append("Content-Type", "application/json");

  const updateBody = JSON.stringify({
    fields: fields
  });

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

// Helper function to send log to Slack
const sendSlackLog = async (webhookUrl, data) => {
  if (!webhookUrl) {
    return; // Silently fail if Slack webhook is not configured
  }

  try {
    const slackMessage = {
      text: `💰 Pagamento Processado - Asaas Webhook`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "💰 Pagamento Processado",
            emoji: true
          }
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*ID da Inscrição:*\n${data.inscriptionId || 'N/A'}`
            },
            {
              type: "mrkdwn",
              text: `*Evento:*\n${data.eventType || 'N/A'}`
            },
            {
              type: "mrkdwn",
              text: `*Status:*\n${data.paymentStatus || 'N/A'}`
            },
            {
              type: "mrkdwn",
              text: `*Valor:*\n${data.amount ? `R$ ${data.amount.toFixed(2)}` : 'N/A'}`
            },
            {
              type: "mrkdwn",
              text: `*Nome:*\n${data.userName || 'N/A'}`
            },
            {
              type: "mrkdwn",
              text: `*Email:*\n${data.userEmail || 'N/A'}`
            },
            {
              type: "mrkdwn",
              text: `*Status Atualizado:*\n${data.statusUpdated ? '✅ Sim' : '❌ Não'}`
            },
            {
              type: "mrkdwn",
              text: `*Email Enviado:*\n${data.emailSent ? '✅ Sim' : '❌ Não'}`
            }
          ]
        }
      ]
    };

    // Add error message if present
    if (data.error) {
      slackMessage.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⚠️ Erro:*\n\`\`\`${data.error}\`\`\``
        }
      });
    }

    // Add timestamp
    slackMessage.blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🕐 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        }
      ]
    });

    const slackOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(slackMessage),
      redirect: 'follow'
    };

    await fetch(webhookUrl, slackOptions);
  } catch (error) {
    // Log error but don't fail the webhook processing
    console.error('Failed to send Slack notification:', error);
  }
};

const handler = async (event) => {
  try {
    // Verify it's a POST request
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ message: 'Method not allowed. Use POST.' })
      }
    }

    // Parse webhook payload
    let webhookData;
    try {
      webhookData = JSON.parse(event.body);
    } catch (parseError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid JSON payload', error: parseError.toString() })
      }
    }

    // Get environment variables
    const { RESEND_API_KEY, AIRTABLE_API_KEY, SLACK_WEBHOOK_URL } = process.env;

    if (!RESEND_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'RESEND_API_KEY not configured' })
      }
    }

    if (!AIRTABLE_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'AIRTABLE_API_KEY not configured' })
      }
    }

    // Airtable configuration
    const BASE_ID = 'app1w80Zv4Vo2FUdN';
    const TABLE_NAME = 'Inscritos';
    const SEARCH_FIELD = 'Id da Inscrição';
    const STATUS_FIELD = 'Status';
    const EMAIL_FIELD = 'Email';
    const TAGS_FIELD = 'Tags';
    const STATUS_VALUE = 'Pago';
    const TAG_EMAIL_PAGAMENTO = 'email-pagamento';

    // Step 1: Extract ID da Inscrição from webhook data
    // Try description first, then name as fallback
    const description = webhookData.description || webhookData.payment?.description || '';
    const name = webhookData.name || webhookData.payment?.name || '';
    
    let inscriptionId = extractInscriptionId(description);
    if (!inscriptionId) {
      inscriptionId = extractInscriptionId(name);
    }

    if (!inscriptionId) {
      // Log to Slack if configured
      if (SLACK_WEBHOOK_URL) {
        await sendSlackLog(SLACK_WEBHOOK_URL, {
          error: 'Could not extract ID da Inscrição from webhook data',
          description: description,
          name: name
        });
      }

      return {
        statusCode: 400,
        body: JSON.stringify({ 
          message: 'Could not extract ID da Inscrição from webhook data',
          description: description,
          name: name
        })
      }
    }

    // Step 2: Check payment status
    // Asaas webhook events:
    // - PAYMENT_CONFIRMED: Definitive confirmation (recommended)
    // - PAYMENT_RECEIVED: Payment received (may be temporary, especially for PIX)
    // We accept both, but PAYMENT_CONFIRMED is more reliable
    const eventType = webhookData.event || webhookData.action || '';
    const paymentStatus = webhookData.payment?.status || webhookData.status || '';
    
    // Process confirmed or received payments
    // Note: PAYMENT_CONFIRMED is definitive, PAYMENT_RECEIVED may be reversed
    const isPaymentConfirmed = 
      eventType === 'PAYMENT_CONFIRMED' ||
      eventType === 'PAYMENT_RECEIVED' ||
      paymentStatus === 'CONFIRMED' ||
      paymentStatus === 'RECEIVED' ||
      paymentStatus === 'RECEIVED_IN_CASH_OFFLINE';

    if (!isPaymentConfirmed) {
      // Log to Slack if configured
      if (SLACK_WEBHOOK_URL) {
        await sendSlackLog(SLACK_WEBHOOK_URL, {
          inscriptionId: inscriptionId,
          eventType: eventType,
          paymentStatus: paymentStatus,
          error: 'Payment not confirmed yet, skipping'
        });
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Payment not confirmed yet, skipping',
          eventType: eventType,
          paymentStatus: paymentStatus
        })
      }
    }

    // Step 3: Find record in Airtable
    const record = await findRecordFull(BASE_ID, TABLE_NAME, SEARCH_FIELD, inscriptionId, AIRTABLE_API_KEY);

    if (!record) {
      // Log to Slack if configured
      if (SLACK_WEBHOOK_URL) {
        await sendSlackLog(SLACK_WEBHOOK_URL, {
          inscriptionId: inscriptionId,
          eventType: eventType,
          paymentStatus: paymentStatus,
          error: `Record with Id da Inscrição "${inscriptionId}" not found`
        });
      }

      return {
        statusCode: 404,
        body: JSON.stringify({ 
          message: `Record with Id da Inscrição "${inscriptionId}" not found`
        })
      }
    }

    // Step 4: Check if email-pagamento tag already exists
    const currentTags = record.fields[TAGS_FIELD] || [];
    const hasEmailTag = Array.isArray(currentTags) && currentTags.includes(TAG_EMAIL_PAGAMENTO);

    // Step 5: Prepare fields to update
    const fieldsToUpdate = {
      [STATUS_FIELD]: STATUS_VALUE
    };

    // Step 6: Send email if tag doesn't exist
    if (!hasEmailTag) {
      // Get user email from record
      const userEmail = record.fields[EMAIL_FIELD];

      if (!userEmail) {
        // Update status even if email is missing
        await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, AIRTABLE_API_KEY);
        
        // Log to Slack if configured
        if (SLACK_WEBHOOK_URL) {
          const userName = record.fields['Nome'] || record.fields['name'] || 'Usuário';
          const paymentAmount = webhookData.payment?.value || webhookData.value || null;
          
          await sendSlackLog(SLACK_WEBHOOK_URL, {
            inscriptionId: inscriptionId,
            eventType: eventType,
            paymentStatus: paymentStatus,
            userName: userName,
            userEmail: 'N/A',
            amount: paymentAmount,
            statusUpdated: true,
            emailSent: false,
            error: 'User email not found in Airtable record'
          });
        }
        
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            message: 'User email not found in Airtable record. Status updated but email not sent.',
            inscriptionId: inscriptionId
          })
        }
      }

      // Extract event name from description or name for email
      const eventNameMatch = description.match(/para\s+([^(]+)\s+da/) || name.match(/Inscrição\s+([^:]+):/);
      const eventName = eventNameMatch ? eventNameMatch[1].trim() : 'Evento';

      // Get user name from record
      const userName = record.fields['Nome'] || record.fields['name'] || 'Usuário';

      // Get payment amount from webhook data
      const paymentAmount = webhookData.payment?.value || webhookData.value || null;

      // Send email via Resend
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
            <p>Sua inscrição está completa e confirmada. Em breve você receberá mais informações sobre o evento.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #666;">Este é um email automático, por favor não responda.</p>
          </div>
        </body>
        </html>
      `;

      const resendHeaders = new Headers();
      resendHeaders.append("Authorization", `Bearer ${RESEND_API_KEY}`);
      resendHeaders.append("Content-Type", "application/json");

      const resendBody = JSON.stringify({
        from: "contato@metodistarenovada.com",
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
        // Update status even if email fails
        await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, AIRTABLE_API_KEY);
        
        // Log error to Slack if configured
        if (SLACK_WEBHOOK_URL) {
          await sendSlackLog(SLACK_WEBHOOK_URL, {
            inscriptionId: inscriptionId,
            eventType: eventType,
            paymentStatus: paymentStatus,
            userName: userName,
            userEmail: userEmail,
            amount: paymentAmount,
            statusUpdated: true,
            emailSent: false,
            error: `Failed to send email via Resend: ${JSON.stringify(resendResult)}`
          });
        }
        
        return {
          statusCode: resendResponse.status,
          body: JSON.stringify({ 
            message: 'Failed to send email via Resend, but status was updated',
            error: resendResult,
            inscriptionId: inscriptionId
          })
        }
      }

      // Add email-pagamento tag to prevent duplicates
      const updatedTags = Array.isArray(currentTags) 
        ? [...currentTags, TAG_EMAIL_PAGAMENTO]
        : [TAG_EMAIL_PAGAMENTO];

      fieldsToUpdate[TAGS_FIELD] = updatedTags;

      // Log successful email send to Slack
      if (SLACK_WEBHOOK_URL) {
        await sendSlackLog(SLACK_WEBHOOK_URL, {
          inscriptionId: inscriptionId,
          eventType: eventType,
          paymentStatus: paymentStatus,
          userName: userName,
          userEmail: userEmail,
          amount: paymentAmount,
          statusUpdated: true,
          emailSent: true
        });
      }
    } else {
      // Log status update only (email already sent) to Slack
      if (SLACK_WEBHOOK_URL) {
        const userName = record.fields['Nome'] || record.fields['name'] || 'Usuário';
        const userEmail = record.fields[EMAIL_FIELD] || 'N/A';
        const paymentAmount = webhookData.payment?.value || webhookData.value || null;

        await sendSlackLog(SLACK_WEBHOOK_URL, {
          inscriptionId: inscriptionId,
          eventType: eventType,
          paymentStatus: paymentStatus,
          userName: userName,
          userEmail: userEmail,
          amount: paymentAmount,
          statusUpdated: true,
          emailSent: false
        });
      }
    }

    // Step 7: Update record in Airtable
    await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, AIRTABLE_API_KEY);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Payment confirmed and processed successfully',
        inscriptionId: inscriptionId,
        statusUpdated: true,
        emailSent: !hasEmailTag
      })
    }

  } catch (error) {
    // Log error to Slack if configured
    const { SLACK_WEBHOOK_URL } = process.env;
    if (SLACK_WEBHOOK_URL) {
      try {
        await sendSlackLog(SLACK_WEBHOOK_URL, {
          error: `Internal server error: ${error.toString()}`
        });
      } catch (slackError) {
        console.error('Failed to send error to Slack:', slackError);
      }
    }

    return { 
      statusCode: 500, 
      body: JSON.stringify({ message: 'Internal server error', error: error.toString() })
    }
  }
}

module.exports = { handler }

