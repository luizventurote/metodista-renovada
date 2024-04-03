// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2
const handler = async (event) => {
  try {

    // Get request id, name and age param
    const { id, name, age, payment, eventname } = event.queryStringParameters;

    // Verify if request id, name and age param exists
    if (!id || !name || !age || !payment) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters' })
      }
    }

    // If eventname is not provided, set default value
    if (!eventname) {
      eventname = "Retiro";
    }

    // Payment Type
    let paymentType = "PIX";
    let maxInstallmentCount = 1;

    // Get environment variables ASAAS_API_KEY
    const { ASAAS_API_KEY } = process.env;

    // Value of payment link
    let value = 180;
    let extraMessage = "";

    if (age >= 5 && age <= 10) {
      value = 100;
      extraMessage = "Valor promocional para criança.";
    }

    if (age < 5) {
      value = 0;
      extraMessage = "Criança isenta de pagamento.";
    }

    // Credit card payment fee
    if (payment.toLowerCase().includes("cart") && age >= 5) {
      paymentType = "CREDIT_CARD";
      maxInstallmentCount = 3;
      value = value + 20;

      if ( age <= 10 ) {
        value = value + 15;
      }

      extraMessage = extraMessage + " Pagamento via cartão de crédito com acréscimo da taxa do cartão.";
    }

    var myHeaders = new Headers();
    myHeaders.append("access_token", ASAAS_API_KEY);
    myHeaders.append("Content-Type", "application/json");

    var raw = JSON.stringify({
      "billingType": paymentType,
      "chargeType": "INSTALLMENT",
      "maxInstallmentCount": maxInstallmentCount,
      "callback": {
        "autoRedirect": true,
        "successUrl": "https://www.metodistarenovada.com/retiro-pagamento-obrigado"
      },
      "name": "Inscrição Retiro de Carnaval de 2024: " + name + " (" + id + ")",
      "description": "Inscrição de " + name + " para o " + eventname + " da Igreja Metodista Renovada ("+id+"). " + extraMessage,
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
