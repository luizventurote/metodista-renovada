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

const handler = async (event) => {
  try {
    // Get request parameters
    const { id, name, event: eventName } = event.queryStringParameters;

    // Verify required parameters
    if (!id || !name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters: id and name are required' })
      };
    }

    // Get environment variables
    const { RESEND_API_KEY, AIRTABLE_API_KEY } = process.env;

    if (!RESEND_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'RESEND_API_KEY not configured' })
      };
    }

    if (!AIRTABLE_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'AIRTABLE_API_KEY not configured' })
      };
    }

    // Airtable configuration
    const BASE_ID = 'app1w80Zv4Vo2FUdN';
    const TABLE_NAME = 'Inscritos';
    const SEARCH_FIELD = 'Id da Inscrição';
    const STATUS_FIELD = 'Status';
    const EMAIL_FIELD = 'Email';
    const TAGS_FIELD = 'Tags';
    const STATUS_VALUE = 'Isenta';
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
      };
    }

    // Step 3: Check if email-inscricao tag already exists
    const currentTags = record.fields[TAGS_FIELD] || [];
    const hasEmailTag = Array.isArray(currentTags) && currentTags.includes(TAG_EMAIL_INSCRICAO);

    // Step 4: Prepare fields to update
    const fieldsToUpdate = {
      [STATUS_FIELD]: STATUS_VALUE
    };

    // Step 5: Send email if tag doesn't exist
    if (!hasEmailTag) {
      // Get user email from record
      const userEmail = record.fields[EMAIL_FIELD];

      if (!userEmail) {
        // Update status even if email is missing
        await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, AIRTABLE_API_KEY);
        
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'User email not found in Airtable record. Status updated but email not sent.' })
        };
      }

      // Use event name from parameter or default
      const eventNameText = eventName || 'Evento';

      // Send email via Resend
      const emailSubject = `Inscrição Confirmada - ${eventNameText}`;
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2c3e50;">Inscrição Confirmada!</h2>
            <p>Olá <strong>${name}</strong>,</p>
            <p>Sua inscrição para o evento <strong>${eventNameText}</strong> foi confirmada com sucesso!</p>
            <p>Sua inscrição está <strong>isenta de pagamento</strong>.</p>
            <p>Sua inscrição está completa e confirmada.</p>
          </div>
        </body>
        </html>
      `;

      const resendHeaders = new Headers();
      resendHeaders.append("Authorization", `Bearer ${RESEND_API_KEY}`);
      resendHeaders.append("Content-Type", "application/json");

      const resendBody = JSON.stringify({
        from: "Igreja Metodista Renovada <luiz@metodistarenovada.com>",
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
        
        return {
          statusCode: resendResponse.status,
          body: JSON.stringify({ 
            message: 'Failed to send email via Resend, but status was updated',
            error: resendResult
          })
        };
      }

      // Add email-inscricao tag to prevent duplicates
      const updatedTags = Array.isArray(currentTags) 
        ? [...currentTags, TAG_EMAIL_INSCRICAO]
        : [TAG_EMAIL_INSCRICAO];

      fieldsToUpdate[TAGS_FIELD] = updatedTags;
    }

    // Step 6: Update record in Airtable
    await updateRecord(BASE_ID, TABLE_NAME, record.id, fieldsToUpdate, AIRTABLE_API_KEY);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Exempt registration processed successfully',
        statusUpdated: true,
        emailSent: !hasEmailTag
      })
    };

  } catch (error) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ message: 'Internal server error', error: error.toString() })
    };
  }
};

module.exports = { handler };

