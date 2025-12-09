// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2
const handler = async (event) => {
  try {

    const THANKYOU_URL = 'https://www.metodistarenovada.com/event-pagamento-obrigado';
    const MIN_AGE_FOR_PAYMENT = 6;

    // Get request id, name and age param
    const { id, name, age, payment, eventname } = event.queryStringParameters;

    // Verify if request id, name and age param exists
    if (!id || !name || !age || !payment) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing parameters' })
      }
    }

    let eventnameText = eventname;

    // If eventname is not provided, set default value
    if (!eventnameText || eventnameText === "" || eventnameText === "undefined" || eventnameText === "null") {
      eventnameText = "Retiro";
    }

    // Payment Type
    let paymentType = "PIX";
    let maxInstallmentCount = 1;

    // Get environment variables ASAAS_API_KEY
    const { ASAAS_API_KEY } = process.env;

    // Value of payment link
    let value = 135;
    let extraMessage = "";

    if (age >= MIN_AGE_FOR_PAYMENT && age <= 10) {
      value = 100;
      extraMessage = "Valor promocional para criança.";
    }

    if (age < MIN_AGE_FOR_PAYMENT) {
      value = 0;
      extraMessage = "Criança isenta de pagamento.";
    }

    // Credit card payment fee
    if (payment.toLowerCase().includes("cart") && age >= MIN_AGE_FOR_PAYMENT) {
      paymentType = "CREDIT_CARD";
      maxInstallmentCount = 3;

      value = value + 15;

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
        "successUrl": THANKYOU_URL
      },
      "name": "Inscrição " + eventnameText + ": " + name + " (" + id + ")",
      "description": "Inscrição de " + name + " para " + eventnameText + " da Igreja Metodista Renovada ("+id+"). " + extraMessage,
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
