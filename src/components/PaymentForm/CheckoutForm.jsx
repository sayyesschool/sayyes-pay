const CheckoutForm = ({ format, pack, amount, customer }) => {
    const description = `${format.title} ${pack?.description || ''}`.trim();
    const sum = Number(amount).toFixed(2);
    const custName = `${customer.firstname} ${customer.lastname}`;
    const receipt = JSON.stringify({
        customer: {
            email: customer.email
        },
        taxSystem: 6,
        items: [{
            quantity: 1,
            price: {
                amount: sum
            },
            tax: 1,
            text: 'Оплата за тренинги',
            paymentMethodType: 'full_payment',
            paymentSubjectType: 'service'
        }]
    });

    return (
        <form id="checkout-form" method="post" action="https://yoomoney.ru/eshop.xml">
            <input type="hidden" name="shopId" value="642518" required />
            <input type="hidden" name="scid" value="1263227" required />
            <input type="hidden" name="sum" value={sum} required />
            <input type="hidden" name="customerNumber" value={customer.email} required />
            <input type="hidden" name="custName" value={custName} />
            <input type="hidden" name="custEmail" value={customer.email} />
            <input type="hidden" name="cps_email" value={customer.email} />
            <input type="hidden" name="orderDetails" value={description} />
            <input type="hidden" name="shopSuccessURL" value="https://payment.sayes.ru/success.php" />
            <input type="hidden" name="shopFailURL" value="https://payment.sayes.ru" />
            <input type="hidden" name="ym_merchant_receipt" value={receipt} />
        </form>
    );
};

export default CheckoutForm;