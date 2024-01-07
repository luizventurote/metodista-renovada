// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2
const handler = async (event) => {
  try {

    // Get request id, name and age param
    const { id, name, age } = event.queryStringParameters;

    // Verify if request id, name and age param exists
    if (!id || !name || !age) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters' })
      }
    }

    // Get environment variables ASAAS_API_KEY
    const { ASAAS_API_KEY } = process.env;

    // Value of payment link
    let value = 150;
    let extraMessage = "";

    if (age >= 6 && age <= 10) {
      value = 100;
      extraMessage = "Valor promocional para criança.";
    }

    if (age < 6) {
      value = 0;
      extraMessage = "Criança isenta de pagamento.";
    }

    var myHeaders = new Headers();
    myHeaders.append("access_token", ASAAS_API_KEY);
    myHeaders.append("Content-Type", "application/json");

    var raw = JSON.stringify({
      "billingType": "UNDEFINED",
      "chargeType": "INSTALLMENT",
      "maxInstallmentCount": 1,
      "callback": {
        "autoRedirect": true,
        "successUrl": "https://www.metodistarenovada.com/retiro-pagamento-obrigado"
      },
      "name": "Inscrição Retiro de Carnaval de 2024: " + name + " (" + id + ")",
      "description": "Inscrição de " + name + " para o Retiro de Carnaval de 2024 da Igreja Metodista Renovada ("+id+"). " + extraMessage,
      "value": value,
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
