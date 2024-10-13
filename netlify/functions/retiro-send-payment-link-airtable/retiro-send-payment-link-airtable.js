// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to find record in Airtable
const findRecord = async (baseId, tableName, searchField, id, apiKey) => {
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

  return findResult.records[0].id;
};

const handler = async (event) => {
  try {
    // Get request id and payment_link param
    const { id, payment_link } = event.queryStringParameters;

    // Verify if request id and payment_link param exists
    if (!id || !payment_link) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters' })
      }
    }

    // Get environment variable AIRTABLE_API_KEY
    const { AIRTABLE_API_KEY } = process.env;

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
    const UPDATE_FIELD = 'Link de Pagamento';

    // Retry configuration
    const INITIAL_DELAY = 2000; // 2 seconds initial delay
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1000; // 1 second between retries

    // Step 1: Wait initial delay to allow Airtable record creation
    await delay(INITIAL_DELAY);

    // Step 2: Find record by Id da Inscrição with retries
    let recordId = null;
    let attempts = 0;

    while (attempts < MAX_RETRIES && !recordId) {
      recordId = await findRecord(BASE_ID, TABLE_NAME, SEARCH_FIELD, id, AIRTABLE_API_KEY);
      
      if (!recordId && attempts < MAX_RETRIES - 1) {
        // Wait before retrying
        await delay(RETRY_DELAY);
      }
      
      attempts++;
    }

    // Check if record was found after all retries
    if (!recordId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          message: `Record with Id da Inscrição "${id}" not found after ${MAX_RETRIES} attempts`,
          attempts: attempts
        })
      }
    }

    // Step 2: Update the record with payment link
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}/${recordId}`;

    const updateHeaders = new Headers();
    updateHeaders.append("Authorization", `Bearer ${AIRTABLE_API_KEY}`);
    updateHeaders.append("Content-Type", "application/json");

    const updateBody = JSON.stringify({
      fields: {
        [UPDATE_FIELD]: payment_link
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
      return {
        statusCode: updateResponse.status,
        body: JSON.stringify({ message: 'Failed to update record', error: updateResult })
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Payment link updated successfully',
        recordId: recordId,
        result: updateResult
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
