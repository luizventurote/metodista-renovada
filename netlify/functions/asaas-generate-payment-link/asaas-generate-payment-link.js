// Docs on event and context https://docs.netlify.com/functions/build/#code-your-function-2
const handler = async (event) => {
    try {

      // Get environment variables ASAAS_API_KEY
      const { ASAAS_API_KEY } = process.env;
  
      var myHeaders = new Headers();
      myHeaders.append("access_token", ASAAS_API_KEY);
      myHeaders.append("Content-Type", "application/json");
  
      var raw = JSON.stringify({
        "billingType": "UNDEFINED",
        "chargeType": "INSTALLMENT",
        "maxInstallmentCount": 1,
        "callback": {
          "autoRedirect": true,
          "successUrl": "https://www.metodistarenovada.com/oferta?pagamento=confirmado"
        },
        "name": "Doação para a construção da nova sede da Igreja Metodista Renovada de Colatina",
        "description": "Faça a sua doação para ajudar na construção da nova sede da Igreja Metodista Renovada de Colatina. \"O tamanho da fé é o que define o tamanho de uma igreja, pois nosso limite de expansão depende do quanto acreditamos\"",
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
  