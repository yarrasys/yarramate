export interface Order {
  readonly id: string
  readonly customerId: string
}

export class OrderRepository {
  private readonly orders = new Map<string, Order>()

  save(order: Order): void {
    this.orders.set(order.id, order)
  }
}

export class OrderApi {
  constructor(private readonly repository: OrderRepository) {}

  create(order: Order): void {
    this.repository.save(order)
  }
}
