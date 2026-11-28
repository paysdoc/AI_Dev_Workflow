package fixture.steps

import io.cucumber.java.en.Given
import io.cucumber.java.en.Then

class InvoiceSteps {
    @Then("the invoice is sent")
    fun theInvoiceIsSent() {}

    @Given("a returning customer")
    fun aReturningCustomer() {}
}
