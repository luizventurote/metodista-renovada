// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2
const handler = async (event) => {
  try {

    // Get request id, name and payment_method param
    const { id, name, payment_method } = event.queryStringParameters;

    // Verify if request id, name and payment_method param exists
    if (!id || !name || !payment_method) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters' })
      }
    }

    // Get environment variables ASAAS_API_KEY
    const { ASAAS_API_KEY } = process.env;

    var myHeaders = new Headers();
    myHeaders.append("access_token", ASAAS_API_KEY);
    myHeaders.append("Content-Type", "application/json");

    var raw = JSON.stringify({
      "billingType": "UNDEFINED",
      "chargeType": "DETACHED",
      "callback": {
        "autoRedirect": true,
        "successUrl": "https://www.luizventurote.com/"
      },
      "name": "Inscrição Retiro de Carnaval de 2024: " + name + " (" + id + ")",
      "description": "Inscrição de " + name + " para o Retiro de Carnaval de 2024 da Igreja Metodista Renovada ("+id+").",
      "value": 130,
      "notificationEnabled": false,
      "dueDateLimitDays": 3
    });

    var requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: raw,
      redirect: 'follow'
    };

    return fetch("https://api.asaas.com/v3/paymentLinks", requestOptions)
          .then(response => response.json())
          .then(result => {
            return {
              statusCode: 200,
              body: JSON.stringify({ result }),
              // // more keys you can return:
              // headers: { "headerName": "headerValue", ... },
              // isBase64Encoded: true,
            }
          })
          .catch(error => console.log('error', error));
  } catch (error) {
    return { statusCode: 500, body: error.toString() }
  }
}

module.exports = { handler }
