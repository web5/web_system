import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findAll(page: number = 1, limit: number = 10) {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;

    const [users, total] = await this.userRepository.findAndCount({
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      order: { createdAt: 'DESC' },
    });
    const safeUsers = users.map((u) => {
      const { password: _pwd, ...rest } = JSON.parse(JSON.stringify(u));
      return rest;
    });
    return {
      list: safeUsers,
      total,
      page: pageNum,
      pageSize: limitNum,
    };
  }

  private async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: Number(id) } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findOne(id: string): Promise<Omit<User, 'password'>> {
    const user = await this.findById(id);
    const { password: _pwd, ...safeUser } = JSON.parse(JSON.stringify(user));
    return safeUser;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { username } });
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.userRepository.create(userData);
    return this.userRepository.save(user);
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    const user = await this.findById(id);
    Object.assign(user, userData);
    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.userRepository.remove(user);
  }
}
