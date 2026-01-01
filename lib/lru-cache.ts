/**
 * High-performance LRU Cache implementation
 * O(1) get and set operations using a hash map + doubly linked list
 */

class ListNode<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: ListNode<K, V> | null = null,
    public next: ListNode<K, V> | null = null
  ) {}
}

export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, ListNode<K, V>>;
  private head: ListNode<K, V> | null;
  private tail: ListNode<K, V> | null;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
    this.head = null;
    this.tail = null;
  }

  get(key: K): V | undefined {
    const node = this.cache.get(key);
    if (!node) return undefined;

    // Move to front (most recently used)
    this.moveToFront(node);
    return node.value;
  }

  set(key: K, value: V): void {
    let node = this.cache.get(key);

    if (node) {
      // Update existing node
      node.value = value;
      this.moveToFront(node);
    } else {
      // Create new node
      node = new ListNode(key, value);
      this.cache.set(key, node);
      this.addToFront(node);

      // Check capacity
      if (this.cache.size > this.capacity) {
        this.removeLeastRecentlyUsed();
      }
    }
  }

  private moveToFront(node: ListNode<K, V>): void {
    if (node === this.head) return;

    this.removeNode(node);
    this.addToFront(node);
  }

  private addToFront(node: ListNode<K, V>): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: ListNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private removeLeastRecentlyUsed(): void {
    if (!this.tail) return;

    this.cache.delete(this.tail.key);
    this.removeNode(this.tail);
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  size(): number {
    return this.cache.size;
  }
}
