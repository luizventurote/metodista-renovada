// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// Helper function to update record tags in Airtable
const updateRecordTags = async (baseId, tableName, recordId, tags, apiKey) => {
  const updateUrl = `https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`;

  const updateHeaders = new Headers();
  updateHeaders.append("Authorization", `Bearer ${apiKey}`);
  updateHeaders.append("Content-Type", "application/json");

  const updateBody = JSON.stringify({
    fields: {
      "Tags": tags
    }
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
    throw new Error(`Failed to update tags: ${JSON.stringify(updateResult)}`);
  }

  return updateResult;
};

const handler = async (event) => {
  try {
    // Get request parameters
    const { id, name, event, payment_link } = event.queryStringParameters;

    // Verify required parameters
    if (!id || !name || !event || !payment_link) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters: id, name, event, and payment_link are required' })
      }
    }

    // Get environment variables
    const { RESEND_API_KEY, AIRTABLE_API_KEY } = process.env;

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
    const EMAIL_FIELD = 'Email';
    const TAGS_FIELD = 'Tags';
    const TAG_EMAIL_INSCRICAO = 'email-inscricao';

    // Retry configuration
    const INITIAL_DELAY = 2000; // 2 seconds initial delay
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1000; // 1 second between retries

    // Step 1: Wait initial delay to allow Airtable record creation
    await delay(INITIAL_DELAY);

    // Step 2: Find record by Id da Inscrição with retries
    let record = null;
    let attempts = 0;

    while (attempts < MAX_RETRIES && !record) {
      record = await findRecordFull(BASE_ID, TABLE_NAME, SEARCH_FIELD, id, AIRTABLE_API_KEY);
      
      if (!record && attempts < MAX_RETRIES - 1) {
        // Wait before retrying
        await delay(RETRY_DELAY);
      }
      
      attempts++;
    }

    // Check if record was found after all retries
    if (!record) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          message: `Record with Id da Inscrição "${id}" not found after ${MAX_RETRIES} attempts`,
          attempts: attempts
        })
      }
    }

    // Step 3: Check if email-inscricao tag already exists
    const currentTags = record.fields[TAGS_FIELD] || [];
    const hasEmailTag = Array.isArray(currentTags) && currentTags.includes(TAG_EMAIL_INSCRICAO);

    if (hasEmailTag) {
      // Email already sent, return success without sending again
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Email already sent (tag exists), skipping',
          skipped: true
        })
      }
    }

    // Step 4: Get user email from record
    const userEmail = record.fields[EMAIL_FIELD];

    if (!userEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'User email not found in Airtable record' })
      }
    }

    // Step 5: Send email via Resend
    const emailSubject = `Inscrição Realizada com Sucesso - ${event}`;
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2c3e50;">Inscrição Realizada com Sucesso!</h2>
          <p>Olá <strong>${name}</strong>,</p>
          <p>Sua inscrição para o evento <strong>${event}</strong> foi realizada com sucesso!</p>
          <p>Para finalizar sua inscrição, você precisa realizar o pagamento. Clique no botão abaixo para acessar o link de pagamento:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${payment_link}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Realizar Pagamento</a>
          </div>
          <p>Ou copie e cole o link abaixo no seu navegador:</p>
          <p style="word-break: break-all; color: #0066cc;">${payment_link}</p>
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
      return {
        statusCode: resendResponse.status,
        body: JSON.stringify({ 
          message: 'Failed to send email via Resend', 
          error: resendResult 
        })
      }
    }

    // Step 6: Add email-inscricao tag to the record (preserving existing tags)
    const updatedTags = Array.isArray(currentTags) 
      ? [...currentTags, TAG_EMAIL_INSCRICAO]
      : [TAG_EMAIL_INSCRICAO];

    try {
      await updateRecordTags(BASE_ID, TABLE_NAME, record.id, updatedTags, AIRTABLE_API_KEY);
    } catch (tagError) {
      // Log error but don't fail the request since email was sent successfully
      console.error('Failed to update tags:', tagError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Email sent successfully',
        emailId: resendResult.id,
        recipient: userEmail
      })
    }

  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ message: 'Internal server error', error: error.toString() })
    }
  }
}

module.exports = { handler }

